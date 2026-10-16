package probe

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"testing"
	"time"
)

var loopback = netip.MustParseAddr("127.0.0.1")

func TestTCPUpWhenListening(t *testing.T) {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	res, err := TCP(context.Background(), loopback, port, 2*time.Second)
	if err != nil || !res.Up {
		t.Fatalf("TCP to listening port = %+v, %v; want up", res, err)
	}
}

func TestTCPUpWhenRefused(t *testing.T) {
	// Grab a free port, then close it so the connection is refused.
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	// Windows retries a refused SYN for about two seconds before reporting it, so allow for that.
	res, err := TCP(context.Background(), loopback, port, 5*time.Second)
	if err != nil || !res.Up {
		t.Fatalf("TCP to closed port = %+v, %v; want up (refused)", res, err)
	}
}

func TestTCPDownOnTimeout(t *testing.T) {
	// 10.255.255.1 is normally unrouted: the SYN goes nowhere and the dial times out.
	start := time.Now()
	res, err := TCP(context.Background(), netip.MustParseAddr("10.255.255.1"), 9, 300*time.Millisecond)
	if err != nil || res.Up {
		t.Fatalf("TCP to blackhole = %+v, %v; want down", res, err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("timeout not honoured: %v", elapsed)
	}
}

func TestICMPLoopback(t *testing.T) {
	p := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	res, err := p.Probe(context.Background(), loopback, 0, time.Second)
	if errors.Is(err, ErrICMPUnsupported) {
		t.Skipf("ICMP not available to this user: %v", err)
	}
	if err != nil || !res.Up {
		t.Fatalf("ICMP to 127.0.0.1 = %+v, %v; want up", res, err)
	}
}

func TestICMPDownOnTimeout(t *testing.T) {
	p := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	start := time.Now()
	res, err := p.Probe(context.Background(), netip.MustParseAddr("10.255.255.1"), 0, 300*time.Millisecond)
	if errors.Is(err, ErrICMPUnsupported) {
		t.Skipf("ICMP not available to this user: %v", err)
	}
	if err != nil || res.Up {
		t.Fatalf("ICMP to blackhole = %+v, %v; want down", res, err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("timeout not honoured: %v", elapsed)
	}
}
