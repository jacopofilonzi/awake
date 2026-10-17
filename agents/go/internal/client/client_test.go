package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/probe"
	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// --- fake server -------------------------------------------------------------------------------

type fakeServer struct {
	t     *testing.T
	srv   *httptest.Server
	conns chan *serverConn
	done  chan struct{}
	once  sync.Once
}

type serverConn struct {
	t *testing.T
	c *websocket.Conn
}

func newFakeServer(t *testing.T) *fakeServer {
	t.Helper()
	fs := &fakeServer{t: t, conns: make(chan *serverConn, 8), done: make(chan struct{})}
	fs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Errorf("accept: %v", err)
			return
		}
		fs.conns <- &serverConn{t: t, c: c}
		// Keep the handler alive: returning would close the connection.
		select {
		case <-fs.done:
		case <-r.Context().Done():
		}
		_ = c.CloseNow() // test teardown; the connection may already be closed
	}))
	t.Cleanup(fs.stop)
	return fs
}

// stop drops every server connection. Tests call it before stopping the agent so that the agent's
// close handshake fails fast instead of waiting 5 s for a server that is not reading.
func (fs *fakeServer) stop() {
	fs.once.Do(func() {
		close(fs.done)
		fs.srv.Close()
	})
}

func (fs *fakeServer) url() string { return "ws" + strings.TrimPrefix(fs.srv.URL, "http") + "/agent" }

func (fs *fakeServer) accept() *serverConn {
	fs.t.Helper()
	select {
	case c := <-fs.conns:
		return c
	case <-time.After(3 * time.Second):
		fs.t.Fatal("agent did not connect")
		return nil
	}
}

// read returns the next message that is not a heartbeat.
func (sc *serverConn) read() map[string]any {
	sc.t.Helper()
	for {
		m, err := sc.readRaw(2 * time.Second)
		if err != nil {
			sc.t.Fatalf("server read: %v", err)
		}
		if m["t"] != protocol.TypeHeartbeat {
			return m
		}
	}
}

func (sc *serverConn) readRaw(timeout time.Duration) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	typ, data, err := sc.c.Read(ctx)
	if err != nil {
		return nil, err
	}
	if typ != websocket.MessageText {
		sc.t.Fatalf("agent sent a binary frame")
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		sc.t.Fatalf("agent sent invalid JSON %q: %v", data, err)
	}
	return m, nil
}

func (sc *serverConn) send(msg string) {
	sc.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := sc.c.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		sc.t.Fatalf("server write: %v", err)
	}
}

// handshake reads hello and answers welcome with hb in test units (10 ms).
func (sc *serverConn) handshake(hb int) map[string]any {
	sc.t.Helper()
	hello := sc.read()
	if hello["t"] != protocol.TypeHello {
		sc.t.Fatalf("first message = %v, want hello", hello)
	}
	b, err := json.Marshal(map[string]any{"t": "welcome", "v": 1, "name": "test-agent", "hb": hb})
	if err != nil {
		sc.t.Fatal(err)
	}
	sc.send(string(b))
	return hello
}

// --- fakes for the agent side ------------------------------------------------------------------

type fakeWaker struct {
	mu   sync.Mutex
	macs [][6]byte
	err  error
}

func (w *fakeWaker) Wake(_ context.Context, mac [6]byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.macs = append(w.macs, mac)
	return w.err
}

type fakeProber struct {
	mu    sync.Mutex
	calls []string
}

func (p *fakeProber) Probe(_ context.Context, ip netip.Addr, port int, timeout time.Duration) (probe.Result, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls = append(p.calls, ip.String())
	if ip.String() == "192.168.1.99" {
		return probe.Result{}, probe.ErrICMPUnsupported
	}
	return probe.Result{Up: true, RTT: 3 * time.Millisecond}, nil
}

type harness struct {
	fs     *fakeServer
	client *Client
	mgr    *outputs.Manager
	waker  *fakeWaker
	prober *fakeProber
	cancel context.CancelFunc
	result chan error
}

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// start runs a client against a fake server; configure (optional) adjusts the client before Run.
func start(t *testing.T, configure ...func(*Client)) *harness {
	t.Helper()
	fs := newFakeServer(t)
	mgr, err := outputs.New([]outputs.Config{
		{ID: "pc-power", Mode: protocol.ModeButton, Driver: "sim", Short: 200 * time.Millisecond, Long: 400 * time.Millisecond},
		{ID: "nas", Mode: protocol.ModeButton, Driver: "sim", Short: 50 * time.Millisecond},
		{ID: "lamp", Mode: protocol.ModeSwitch, Driver: "sim"},
	}, outputs.DefaultDrivers(quietLogger()), quietLogger())
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{fs: fs, mgr: mgr, waker: &fakeWaker{}, prober: &fakeProber{}, result: make(chan error, 1)}
	h.client = New(Options{
		URL: fs.url(), Token: "awk_test", Firmware: "awake-agent-go/test",
		Outputs: mgr, Waker: h.waker, Prober: h.prober, Log: quietLogger(),
	})
	h.client.hbUnit = 10 * time.Millisecond
	h.client.delay = func(int, time.Duration) (time.Duration, time.Duration) { return 20 * time.Millisecond, 0 }
	for _, f := range configure {
		f(h.client)
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go func() { h.result <- h.client.Run(ctx) }()
	t.Cleanup(func() {
		fs.stop()
		cancel()
		select {
		case <-h.result:
		case <-time.After(10 * time.Second):
			t.Error("Run did not return after cancel")
		}
		if err := mgr.Close(); err != nil {
			t.Error(err)
		}
	})
	return h
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// --- tests -------------------------------------------------------------------------------------

func TestHandshakeAndHeartbeat(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	hello := sc.handshake(5)

	if hello["v"] != float64(1) || hello["token"] != "awk_test" || hello["fw"] != "awake-agent-go/test" {
		t.Fatalf("hello = %v", hello)
	}
	outs, _ := hello["outputs"].([]any)
	want := []string{
		`{"id":"pc-power","long":true,"mode":"button"}`,
		`{"id":"nas","long":false,"mode":"button"}`,
		`{"id":"lamp","mode":"switch","on":false}`,
	}
	if len(outs) != len(want) {
		t.Fatalf("outputs = %v", outs)
	}
	for i, o := range outs {
		b, err := json.Marshal(o)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != want[i] {
			t.Errorf("output %d = %s, want %s", i, b, want[i])
		}
	}

	// hb = 5 units = 50 ms: a heartbeat must arrive quickly.
	m, err := sc.readRaw(time.Second)
	if err != nil || m["t"] != "hb" {
		t.Fatalf("expected hb, got %v, %v", m, err)
	}
	sc.send(`{"t":"hb"}`)
	waitFor(t, func() bool { return h.client.Status().Connected })
	if h.client.Status().Name != "test-agent" {
		t.Fatalf("status = %+v", h.client.Status())
	}
}

func TestWake(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.handshake(100)

	sc.send(`{"t":"wake","id":"a","mac":"AA:BB:CC:DD:EE:FF","extra":"ignored"}`)
	if m := sc.read(); m["t"] != "ack" || m["id"] != "a" || m["ok"] != true {
		t.Fatalf("wake reply = %v", m)
	}
	h.waker.mu.Lock()
	got := h.waker.macs
	h.waker.mu.Unlock()
	if len(got) != 1 || got[0] != [6]byte{0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF} {
		t.Fatalf("waker got %X", got)
	}

	sc.send(`{"t":"wake","id":"b","mac":"aa:bb:cc:dd:ee:ff"}`)
	if m := sc.read(); m["id"] != "b" || m["ok"] != false || m["err"] != "invalid" {
		t.Fatalf("invalid wake reply = %v", m)
	}

	h.waker.mu.Lock()
	h.waker.err = errors.New("network down")
	h.waker.mu.Unlock()
	sc.send(`{"t":"wake","id":"c","mac":"AA:BB:CC:DD:EE:FF"}`)
	if m := sc.read(); m["id"] != "c" || m["ok"] != false || m["err"] != "send failed" {
		t.Fatalf("failed wake reply = %v", m)
	}
}

func TestProbe(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.handshake(100)

	sc.send(`{"t":"probe","id":"p1","ip":"192.168.1.20","port":3389,"timeout":500}`)
	if m := sc.read(); m["t"] != "probe_result" || m["id"] != "p1" || m["up"] != true || m["ms"] != float64(3) {
		t.Fatalf("probe reply = %v", m)
	}
	for _, bad := range []string{
		`{"t":"probe","id":"p2","ip":"192.168.1","timeout":500}`,
		`{"t":"probe","id":"p2","ip":"192.168.1.20","port":0,"timeout":500}`,
		`{"t":"probe","id":"p2","ip":"192.168.1.20","port":"x"}`,
	} {
		sc.send(bad)
		if m := sc.read(); m["id"] != "p2" || m["up"] != false || m["err"] != "invalid" {
			t.Fatalf("invalid probe %s reply = %v", bad, m)
		}
	}
	sc.send(`{"t":"probe","id":"p3","ip":"192.168.1.99"}`)
	if m := sc.read(); m["id"] != "p3" || m["up"] != false || m["err"] != "icmp unsupported" {
		t.Fatalf("unsupported probe reply = %v", m)
	}
}

func TestPressRules(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.handshake(100)

	expect := func(cmd, id string, ok bool, errStr string) {
		t.Helper()
		sc.send(cmd)
		m := sc.read()
		if m["t"] != "ack" || m["id"] != id || m["ok"] != ok || (errStr != "" && m["err"] != errStr) {
			t.Fatalf("%s -> %v, want ok=%v err=%q", cmd, m, ok, errStr)
		}
	}
	expect(`{"t":"press","id":"1","out":"pc-power"}`, "1", true, "")
	expect(`{"t":"press","id":"2","out":"pc-power","long":true}`, "2", false, "busy")
	// A local console press also makes the output busy.
	if _, err := h.mgr.Press("nas", false, outputs.CauseLocal); err != nil {
		t.Fatal(err)
	}
	expect(`{"t":"press","id":"3","out":"nas"}`, "3", false, "busy")
	waitFor(t, func() bool { return !h.mgr.Snapshot()[1].Busy })
	expect(`{"t":"press","id":"4","out":"nas","long":true}`, "4", false, "no long press")
	expect(`{"t":"press","id":"5","out":"lamp"}`, "5", false, "wrong mode")
	expect(`{"t":"press","id":"6","out":"nope"}`, "6", false, "unknown output")
	expect(`{"t":"press","id":"7"}`, "7", false, "invalid")
	expect(`{"t":"set","id":"8","out":"pc-power","on":true}`, "8", false, "wrong mode")
	expect(`{"t":"set","id":"9","out":"lamp"}`, "9", false, "invalid")
}

func TestSetAckAndLocalOutState(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.handshake(100)

	sc.send(`{"t":"set","id":"s1","out":"lamp","on":true}`)
	if m := sc.read(); m["t"] != "ack" || m["ok"] != true || m["on"] != true {
		t.Fatalf("set reply = %v", m)
	}
	sc.send(`{"t":"set","id":"s2","out":"lamp","on":true}`)
	if m := sc.read(); m["id"] != "s2" || m["ok"] != true || m["on"] != true {
		t.Fatalf("idempotent set reply = %v", m)
	}
	// A local toggle produces out_state; it must be the very next message, which also proves that the
	// set above did not emit one.
	if _, err := h.mgr.Toggle("lamp", outputs.CauseLocal); err != nil {
		t.Fatal(err)
	}
	if m := sc.read(); m["t"] != "out_state" || m["out"] != "lamp" || m["on"] != false {
		t.Fatalf("after local toggle got %v, want out_state lamp off", m)
	}
}

func TestReconnectHelloCarriesCurrentState(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.handshake(100)
	if err := sc.c.Close(websocket.StatusGoingAway, "server restart"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return !h.client.Status().Connected })
	// Changed while disconnected: nothing is queued, the next hello carries it.
	if _, err := h.mgr.Set("lamp", true, outputs.CauseLocal); err != nil {
		t.Fatal(err)
	}
	sc2 := h.fs.accept()
	hello := sc2.handshake(100)
	outs := hello["outputs"].([]any)
	if lamp := outs[2].(map[string]any); lamp["on"] != true {
		t.Fatalf("lamp in second hello = %v", lamp)
	}
	// Nothing else is sent after the welcome (no replayed out_state).
	sc2.send(`{"t":"hb"}`)
	if m, err := sc2.readRaw(300 * time.Millisecond); err == nil && m["t"] != "hb" {
		t.Fatalf("unexpected message after reconnect: %v", m)
	}
}

func TestSilenceTriggersReconnect(t *testing.T) {
	h := start(t)
	h.fs.accept().handshake(5) // 50 ms: silence after 150 ms
	// The server never answers heartbeats: the agent must give up and reconnect.
	h.fs.accept()
}

func TestCloseVersionUnsupportedStops(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.read() // hello
	if err := sc.c.Close(protocol.CloseVersionUnsupported, "unsupported version"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-h.result:
		h.result <- err // let the cleanup see that Run returned
		if !errors.Is(err, ErrVersionUnsupported) {
			t.Fatalf("Run = %v, want ErrVersionUnsupported", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not stop after 4004")
	}
}

func TestShutdownClosesWith1000(t *testing.T) {
	h := start(t)
	sc := h.fs.accept()
	sc.handshake(100)
	h.cancel()
	for {
		_, err := sc.readRaw(3 * time.Second)
		if err != nil {
			if code := websocket.CloseStatus(err); code != websocket.StatusNormalClosure {
				t.Fatalf("close code = %v (%v), want 1000", code, err)
			}
			return
		}
	}
}

func TestNextDelay(t *testing.T) {
	low := func() float64 { return 0 }
	high := func() float64 { return 0.999999 }

	// Exponential: 1, 2, 4 … capped at 60, ±20 %.
	prev := time.Duration(0)
	for _, base := range []time.Duration{1, 2, 4, 8, 16, 32, 60, 60} {
		base *= time.Second
		wait, next := NextDelay(1006, prev, low)
		if next != base || wait != base*8/10 {
			t.Fatalf("prev=%v: wait=%v next=%v, want next=%v wait=%v", prev, wait, next, base, base*8/10)
		}
		if w, _ := NextDelay(1006, prev, high); w < base || w > base*12/10 {
			t.Fatalf("prev=%v: high jitter wait=%v", prev, w)
		}
		prev = next
	}

	for _, code := range []int{4001, 4003, 4029} {
		for _, rnd := range []func() float64{low, high} {
			wait, _ := NextDelay(code, 0, rnd)
			if wait < 5*time.Minute || wait > 6*time.Minute {
				t.Errorf("code %d: wait %v, want 5-6 min", code, wait)
			}
		}
	}
	if wait, _ := NextDelay(4002, 0, low); wait != 60*time.Second {
		t.Errorf("4002: wait %v, want 60s", wait)
	}
	if wait, _ := NextDelay(4008, 0, low); wait != 800*time.Millisecond {
		t.Errorf("4008: wait %v, want normal backoff", wait)
	}
}
