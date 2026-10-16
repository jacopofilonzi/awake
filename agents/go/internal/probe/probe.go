// Package probe performs the single reachability check of a `probe` command (§4.2 of PROTOCOL.md):
// an ICMP echo, or a TCP connect when a port is given.
//
// ICMP is platform specific: on Windows it uses IcmpSendEcho from iphlpapi.dll, which works without
// administrator rights; elsewhere it uses pro-bing, trying an unprivileged ICMP socket first and a raw
// (privileged) socket second.
package probe

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/netip"
	"strconv"
	"time"
)

// ErrICMPUnsupported means this host cannot send ICMP echoes (no permission, no ICMP socket support).
// The client reports it as `err: "icmp unsupported"` so users know to configure a TCP port.
var ErrICMPUnsupported = errors.New("icmp unsupported")

// Result is the outcome of a check that could be performed.
type Result struct {
	Up  bool
	RTT time.Duration // meaningful only when Up
}

// Prober runs probes. It is safe for concurrent use.
type Prober struct {
	icmp icmpPinger
}

// New returns a Prober that logs platform diagnostics to log.
func New(log *slog.Logger) *Prober {
	return &Prober{icmp: icmpPinger{log: log}}
}

// Probe checks ip once: TCP connect to port when port > 0, ICMP echo otherwise. An error means the
// check could not be performed at all; "host did not answer" is Result{Up: false} with a nil error.
func (p *Prober) Probe(ctx context.Context, ip netip.Addr, port int, timeout time.Duration) (Result, error) {
	if port > 0 {
		return TCP(ctx, ip, port, timeout)
	}
	return p.icmp.ping(ctx, ip, timeout)
}

// TCP connects to ip:port. The host is up when the connection succeeds or is actively refused: a TCP
// RST proves the host is running even if nothing listens on that port.
func TCP(ctx context.Context, ip netip.Addr, port int, timeout time.Duration) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var d net.Dialer
	start := time.Now()
	conn, err := d.DialContext(ctx, "tcp4", net.JoinHostPort(ip.String(), strconv.Itoa(port)))
	rtt := time.Since(start)
	if err == nil {
		// The outcome is already known; a close error cannot change it and there is nothing to retry.
		_ = conn.Close()
		return Result{Up: true, RTT: rtt}, nil
	}
	if isRefused(err) {
		return Result{Up: true, RTT: rtt}, nil
	}
	// Timeout, host unreachable, no route…: all mean "not up" (§4.2). The dial target is a literal IP,
	// so there is no resolver failure that would mean "could not check".
	return Result{Up: false}, nil
}
