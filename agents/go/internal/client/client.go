// Package client runs the agent's connection to the Awake server (PROTOCOL.md §2–8): dial, hello /
// welcome, command dispatch, heartbeats, silence detection and reconnection with backoff.
//
// Concurrency model, per connection ("session"):
//   - the Run goroutine reads messages and dispatches them;
//   - each command runs in its own goroutine, so a slow probe never delays a heartbeat or another command;
//   - one writer goroutine owns all socket writes, fed by a buffered queue: writes are serialized and a
//     command can never block the heartbeat for longer than one write;
//   - a heartbeat goroutine enqueues `hb` every `hb` seconds;
//   - an info goroutine enqueues `info` every 5 minutes (§5.2), when an InfoSource is configured.
//
// Reads use contexts that are NOT derived from the shutdown context: coder/websocket hard-closes the
// connection when a read context is cancelled, which would prevent the clean 1000 close on shutdown.
// Shutdown instead calls Conn.Close(1000), which unblocks the reader.
//
// Switch changes not caused by `set` reach the client through the outputs Manager's callback and are
// sent as out_state only while a session is established (after welcome). Changes made between the hello
// snapshot and the welcome are caught by diffing the two snapshots under the Manager's lock.
//
// The `ip` of info is the local address of the TCP connection to the server: the client dials through
// its own http.Transport whose DialContext records it. That is the address the LAN actually uses to
// reach the server, without guessing among interfaces or sending anything extra.
package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/probe"
	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// Waker sends a Wake-on-LAN magic packet.
type Waker interface {
	Wake(ctx context.Context, mac [6]byte) error
}

// Prober performs one reachability check (port 0 = ICMP).
type Prober interface {
	Probe(ctx context.Context, ip netip.Addr, port int, timeout time.Duration) (probe.Result, error)
}

// InfoSource describes the agent for info (§5.2). local is the local address of the connection to the
// server, nil when unknown. It must not fail: unknown fields are just left empty.
type InfoSource interface {
	Collect(local net.Addr) protocol.Info
}

// Options configures a Client.
type Options struct {
	URL      string
	Token    string
	Firmware string
	Outputs  *outputs.Manager
	Waker    Waker
	Prober   Prober
	// Info is optional: nil sends no info at all.
	Info InfoSource
	Log  *slog.Logger
}

// ErrVersionUnsupported is returned by Run after close code 4004: reconnecting is pointless until the
// agent is updated.
var ErrVersionUnsupported = errors.New("server does not support protocol version 1 (close 4004): update the agent")

const (
	defaultHeartbeat = 20 * time.Second
	// maxHeartbeat bounds a bogus `hb` from the server; silence detection is 3×hb.
	maxHeartbeat = 10 * time.Minute
	// queueSize is the outbound queue per session. Each command produces one reply and out_state comes
	// from human-speed events, so this is never reached in practice; overflowing out_states are dropped
	// (and logged) rather than blocking the outputs Manager.
	queueSize = 64
	// commandTimeout bounds wake/press/set handling, below the server's 5 s ack deadline (§4).
	commandTimeout = 4 * time.Second
	// probeGrace is added to the probe timeout; the reply must arrive within timeout + 3 s (§4.2).
	probeGrace = 2 * time.Second
	// infoInterval is how often info is sent after the hello (§5.2).
	infoInterval = 5 * time.Minute
)

// Status is a snapshot of the connection, for the console.
type Status struct {
	Connected bool
	Name      string // agent name from welcome
	Since     time.Time
	NextRetry time.Time // zero while connected or connecting
	LastError string
}

// Client maintains the connection. Create it with New, then call Run.
type Client struct {
	opts Options
	log  *slog.Logger

	mu     sync.Mutex
	sess   *session // non-nil only after welcome
	status Status

	// http dials the WebSocket handshake; its transport stores each new connection's local address in
	// localAddr. Dials are sequential (one connection at a time), so the value read right after Dial
	// belongs to that connection.
	http      *http.Client
	localAddr atomic.Pointer[net.Addr]

	// Tunables, replaced by tests.
	dialTimeout      time.Duration
	handshakeTimeout time.Duration
	writeTimeout     time.Duration
	hbUnit           time.Duration // unit of welcome.hb (a second in production)
	infoEvery        time.Duration
	delay            func(code int, prev time.Duration) (wait, next time.Duration)
}

// New creates a client and subscribes it to switch changes of opts.Outputs.
func New(opts Options) *Client {
	c := &Client{
		opts:             opts,
		log:              opts.Log,
		dialTimeout:      15 * time.Second,
		handshakeTimeout: 15 * time.Second,
		writeTimeout:     10 * time.Second,
		hbUnit:           time.Second,
		infoEvery:        infoInterval,
		delay: func(code int, prev time.Duration) (time.Duration, time.Duration) {
			return NextDelay(code, prev, rand.Float64)
		},
	}
	c.http = &http.Client{Transport: c.newTransport()}
	opts.Outputs.SetOnChange(c.onOutputChange)
	return c
}

// newTransport is the default transport (proxy from the environment, system TLS roots, timeouts) with
// a dial hook that records the local address. Keep-alives are off: a WebSocket connection is hijacked
// after the handshake, so pooling would only keep a failed handshake's connection, and reusing it would
// skip the dial and leave the recorded address unset.
func (c *Client) newTransport() *http.Transport {
	tr := &http.Transport{Proxy: http.ProxyFromEnvironment}
	if def, ok := http.DefaultTransport.(*http.Transport); ok {
		tr = def.Clone()
	}
	tr.DisableKeepAlives = true
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	tr.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := dialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}
		local := conn.LocalAddr()
		c.localAddr.Store(&local)
		return conn, nil
	}
	return tr
}

// Status returns the current connection status.
func (c *Client) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status
}

// Run connects and reconnects until ctx is cancelled (returns nil) or the server rejects the protocol
// version (returns ErrVersionUnsupported).
func (c *Client) Run(ctx context.Context) error {
	var backoff time.Duration
	for {
		code, welcomed, err := c.connectOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if code == protocol.CloseVersionUnsupported {
			c.log.Error("server rejected the protocol version; not reconnecting", "code", code)
			return ErrVersionUnsupported
		}
		if welcomed {
			backoff = 0
		}
		var wait time.Duration
		wait, backoff = c.delay(code, backoff)
		c.logDisconnect(code, err, wait)

		c.mu.Lock()
		c.status.NextRetry = time.Now().Add(wait)
		if err != nil {
			c.status.LastError = err.Error()
		}
		c.mu.Unlock()

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

// NextDelay computes the wait before the next attempt (§7–8). prev is the previous base delay (0 after
// a welcome); next is the base to pass on the following call. rnd returns a value in [0, 1).
//
// The base starts at 1 s and doubles up to 60 s, with ±20 % jitter. Close codes with a minimum delay
// (4001/4003/4029: 5 min, 4002: 60 s) get that minimum plus up to +20 % jitter, never less, because the
// protocol says "no more often than".
func NextDelay(code int, prev time.Duration, rnd func() float64) (wait, next time.Duration) {
	const (
		first = time.Second
		ceil  = 60 * time.Second
	)
	next = first
	if prev > 0 {
		next = min(prev*2, ceil)
	}
	wait = time.Duration(float64(next) * (0.8 + 0.4*rnd()))

	var floor time.Duration
	switch code {
	case protocol.CloseUnknownToken, protocol.CloseRevoked, protocol.CloseTooManyAttempts:
		floor = 5 * time.Minute
	case protocol.CloseReplaced:
		floor = 60 * time.Second
	}
	if floor > 0 {
		wait = max(wait, time.Duration(float64(floor)*(1+0.2*rnd())))
	}
	return wait, next
}

func (c *Client) logDisconnect(code int, err error, wait time.Duration) {
	attrs := []any{"retry_in", wait.Round(100 * time.Millisecond)}
	if code > 0 {
		attrs = append(attrs, "code", code)
	}
	if err != nil {
		attrs = append(attrs, "err", err)
	}
	switch code {
	case protocol.CloseUnknownToken:
		c.log.Error("server rejected the token (unknown); check AWAKE_TOKEN", attrs...)
	case protocol.CloseRevoked:
		c.log.Error("token revoked or agent deleted; create a new token in the web UI", attrs...)
	case protocol.CloseReplaced:
		c.log.Warn("replaced by another connection with the same token; two agents must not share a token", attrs...)
	case protocol.CloseTooManyAttempts:
		c.log.Warn("server is rate limiting this IP", attrs...)
	case protocol.CloseProtocolError:
		c.log.Error("server reported a protocol error (check outputs in the config)", attrs...)
	case protocol.CloseNoHello:
		c.log.Warn("server did not receive hello in time", attrs...)
	default:
		c.log.Warn("disconnected", attrs...)
	}
}

// session is one established connection (after welcome).
type session struct {
	conn *websocket.Conn
	out  chan []byte
	ctx  context.Context // cancelled when the session ends
}

// send queues msg, waiting if the queue is full.
func (s *session) send(msg any) error {
	data, err := marshal(msg)
	if err != nil {
		return err
	}
	select {
	case s.out <- data:
		return nil
	case <-s.ctx.Done():
		return fmt.Errorf("connection closed before sending %T", msg)
	}
}

// trySend queues msg without blocking; it reports false when the queue is full.
func (s *session) trySend(msg any) (bool, error) {
	data, err := marshal(msg)
	if err != nil {
		return false, err
	}
	select {
	case s.out <- data:
		return true, nil
	default:
		return false, nil
	}
}

func marshal(msg any) ([]byte, error) {
	data, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("encode %T: %w", msg, err)
	}
	if len(data) > protocol.MaxMessageSize {
		return nil, fmt.Errorf("encode %T: %d bytes exceeds the %d-byte limit", msg, len(data), protocol.MaxMessageSize)
	}
	return data, nil
}

// connectOnce runs one connection to completion. It returns the close code received from the server
// (or -1), whether a welcome was received, and the error that ended the connection.
func (c *Client) connectOnce(ctx context.Context) (code int, welcomed bool, err error) {
	c.mu.Lock()
	c.status = Status{Since: time.Now(), LastError: c.status.LastError}
	c.mu.Unlock()

	c.log.Info("connecting", "server", c.opts.URL)
	dctx, cancel := context.WithTimeout(ctx, c.dialTimeout)
	c.localAddr.Store(nil)
	conn, _, err := websocket.Dial(dctx, c.opts.URL, &websocket.DialOptions{HTTPClient: c.http})
	cancel()
	if err != nil {
		return -1, false, fmt.Errorf("dial: %w", err)
	}
	var local net.Addr
	if p := c.localAddr.Load(); p != nil {
		local = *p
	}
	conn.SetReadLimit(protocol.MaxMessageSize)

	// Shutdown watcher: a clean close with 1000, which also unblocks the reader. Deferred calls run in
	// reverse order: stop the watcher, wait for it, then drop the TCP connection if still open.
	stop := make(chan struct{})
	var watcher sync.WaitGroup
	defer func() {
		if err := conn.CloseNow(); err != nil {
			c.log.Debug("close connection", "err", err)
		}
	}()
	defer watcher.Wait()
	defer close(stop)
	watcher.Add(1)
	go func() {
		defer watcher.Done()
		select {
		case <-ctx.Done():
			c.log.Info("closing connection", "code", int(websocket.StatusNormalClosure))
			if err := conn.Close(websocket.StatusNormalClosure, "agent shutting down"); err != nil {
				c.log.Debug("close handshake", "err", err)
			}
		case <-stop:
		}
	}()

	helloStates := c.opts.Outputs.Snapshot()
	hello := buildHello(c.opts.Token, c.opts.Firmware, helloStates)
	hello.Info = c.collectInfo(local)
	if err := c.writeDirect(conn, hello); err != nil {
		return closeCode(err), false, fmt.Errorf("send hello: %w", err)
	}

	welcome, err := c.readWelcome(conn)
	if err != nil {
		return closeCode(err), false, err
	}
	hb := time.Duration(welcome.HB) * c.hbUnit
	if welcome.HB <= 0 || hb > maxHeartbeat {
		c.log.Warn("server sent an unusable heartbeat interval; using the default", "hb", welcome.HB)
		hb = defaultHeartbeat * c.hbUnit / time.Second
	}
	c.log.Info("connected", "name", welcome.Name, "hb", hb)

	sctx, scancel := context.WithCancel(ctx)
	defer scancel()
	sess := &session{conn: conn, out: make(chan []byte, queueSize), ctx: sctx}
	c.establish(sess, welcome.Name, helloStates)
	defer c.teardown(sess)

	var workers sync.WaitGroup
	defer workers.Wait()
	defer scancel()
	workers.Add(2)
	go func() { defer workers.Done(); c.writer(sess) }()
	go func() { defer workers.Done(); c.heartbeat(sess, hb) }()
	if c.opts.Info != nil {
		workers.Add(1)
		go func() { defer workers.Done(); c.infoLoop(sess, local) }()
	}

	return c.readLoop(ctx, sess, hb)
}

// establish publishes the session and reports switch changes that happened after the hello snapshot.
// Both happen under the Manager's lock, so no change can slip between them.
func (c *Client) establish(sess *session, name string, helloStates []outputs.State) {
	sent := make(map[string]bool, len(helloStates))
	for _, s := range helloStates {
		if s.Mode == protocol.ModeSwitch {
			sent[s.ID] = s.On
		}
	}
	c.opts.Outputs.WithSnapshot(func(now []outputs.State) {
		c.mu.Lock()
		c.sess = sess
		c.status = Status{Connected: true, Name: name, Since: time.Now()}
		c.mu.Unlock()
		for _, s := range now {
			if on, ok := sent[s.ID]; ok && on != s.On {
				c.queueOutState(sess, s.ID, s.On)
			}
		}
	})
}

func (c *Client) teardown(sess *session) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sess == sess {
		c.sess = nil
		c.status.Connected = false
		c.status.Since = time.Now()
	}
}

func (c *Client) readWelcome(conn *websocket.Conn) (protocol.Welcome, error) {
	var w protocol.Welcome
	rctx, cancel := context.WithTimeout(context.Background(), c.handshakeTimeout)
	defer cancel()
	typ, data, err := conn.Read(rctx)
	if err != nil {
		return w, fmt.Errorf("wait for welcome: %w", err)
	}
	if typ != websocket.MessageText {
		c.closeProtocolError(conn, "expected welcome")
		return w, errors.New("wait for welcome: got a binary frame")
	}
	if err := json.Unmarshal(data, &w); err != nil || w.T != protocol.TypeWelcome {
		c.closeProtocolError(conn, "expected welcome")
		return w, fmt.Errorf("wait for welcome: unexpected message %.100q", data)
	}
	if w.V != protocol.Version {
		c.closeProtocolError(conn, "unsupported version")
		return w, fmt.Errorf("server speaks protocol version %d, this agent %d", w.V, protocol.Version)
	}
	return w, nil
}

func (c *Client) closeProtocolError(conn *websocket.Conn, reason string) {
	if err := conn.Close(websocket.StatusProtocolError, reason); err != nil {
		c.log.Debug("close after protocol error", "err", err)
	}
}

// readLoop reads until the connection ends. A read with no message for 3×hb means the connection is
// dead (half-open TCP after a Wi-Fi drop, §6).
func (c *Client) readLoop(ctx context.Context, sess *session, hb time.Duration) (int, bool, error) {
	silence := 3 * hb
	for {
		rctx, cancel := context.WithTimeout(context.Background(), silence)
		typ, data, err := sess.conn.Read(rctx)
		timedOut := rctx.Err() != nil
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				return int(websocket.StatusNormalClosure), true, nil
			}
			if timedOut {
				return -1, true, fmt.Errorf("no message from the server for %v", silence)
			}
			// Also reached after a write failure: the writer drops the connection, which ends the read.
			return closeCode(err), true, err
		}
		c.dispatch(sess, typ, data)
	}
}

func (c *Client) dispatch(sess *session, typ websocket.MessageType, data []byte) {
	if typ != websocket.MessageText {
		// Binary frames are a protocol error (§2), but tearing the connection down would not help: the
		// agent just ignores what it cannot understand.
		c.log.Warn("ignoring binary frame from the server", "bytes", len(data))
		return
	}
	var env protocol.Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		c.log.Warn("ignoring malformed message from the server", "err", err)
		return
	}
	switch {
	case env.T == protocol.TypeHeartbeat:
		// Any message resets the silence timer; nothing else to do.
	case protocol.IsCommand(env.T):
		go c.handleCommand(sess, env.T, data)
	default:
		c.log.Debug("ignoring message of unknown type", "t", env.T)
	}
}

func (c *Client) writer(sess *session) {
	for {
		select {
		case <-sess.ctx.Done():
			return
		case data := <-sess.out:
			wctx, cancel := context.WithTimeout(context.Background(), c.writeTimeout)
			err := sess.conn.Write(wctx, websocket.MessageText, data)
			cancel()
			if err != nil {
				if sess.ctx.Err() == nil {
					c.log.Warn("write to the server failed", "err", err)
				}
				// Ends the session; CloseNow also unblocks the reader.
				if cerr := sess.conn.CloseNow(); cerr != nil {
					c.log.Debug("close after write failure", "err", cerr)
				}
				return
			}
		}
	}
}

func (c *Client) heartbeat(sess *session, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-sess.ctx.Done():
			return
		case <-t.C:
			if err := sess.send(protocol.Heartbeat{T: protocol.TypeHeartbeat}); err != nil {
				return
			}
		}
	}
}

// infoLoop sends info every infoEvery (§5.2). The hello already carried it, so the first one waits a
// full interval. Info is best effort: a failure to queue it is logged and never ends the session.
func (c *Client) infoLoop(sess *session, local net.Addr) {
	t := time.NewTicker(c.infoEvery)
	defer t.Stop()
	for {
		select {
		case <-sess.ctx.Done():
			return
		case <-t.C:
			info := c.collectInfo(local)
			if info == nil {
				continue
			}
			// trySend: info is not worth waiting for when the queue is full of command replies.
			ok, err := sess.trySend(protocol.InfoMessage{T: protocol.TypeInfo, Info: *info})
			switch {
			case err != nil:
				c.log.Warn("cannot encode info", "err", err)
			case !ok:
				c.log.Debug("send queue full: info skipped")
			}
		}
	}
}

// collectInfo returns the agent's description, or nil when there is none to send.
func (c *Client) collectInfo(local net.Addr) *protocol.Info {
	if c.opts.Info == nil {
		return nil
	}
	info := c.opts.Info.Collect(local)
	if info.IsZero() {
		return nil
	}
	return &info
}

// writeDirect writes before the writer goroutine exists (hello).
func (c *Client) writeDirect(conn *websocket.Conn, msg any) error {
	data, err := marshal(msg)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(context.Background(), c.writeTimeout)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, data)
}

func buildHello(token, fw string, states []outputs.State) protocol.Hello {
	h := protocol.Hello{T: protocol.TypeHello, V: protocol.Version, Token: token, FW: fw}
	for _, s := range states {
		info := protocol.OutputInfo{ID: s.ID, Mode: s.Mode}
		switch s.Mode {
		case protocol.ModeButton:
			long := s.HasLong
			info.Long = &long
		case protocol.ModeSwitch:
			on := s.On
			info.On = &on
		}
		h.Outputs = append(h.Outputs, info)
	}
	return h
}

// onOutputChange runs with the outputs Manager's lock held: it must not block.
func (c *Client) onOutputChange(ch outputs.Change) {
	if ch.Cause == outputs.CauseServer {
		return // reported by the set's ack (§5.1)
	}
	c.mu.Lock()
	sess := c.sess
	c.mu.Unlock()
	if sess == nil {
		c.log.Debug("not connected: switch state will be sent in the next hello", "id", ch.ID, "on", ch.On)
		return
	}
	c.queueOutState(sess, ch.ID, ch.On)
}

func (c *Client) queueOutState(sess *session, id string, on bool) {
	ok, err := sess.trySend(protocol.OutState{T: protocol.TypeOutState, Out: id, On: on})
	switch {
	case err != nil:
		c.log.Error("cannot encode out_state", "id", id, "err", err)
	case !ok:
		c.log.Warn("send queue full: out_state dropped", "id", id, "on", on)
	default:
		c.log.Debug("out_state queued", "id", id, "on", on)
	}
}

func closeCode(err error) int {
	return int(websocket.CloseStatus(err))
}
