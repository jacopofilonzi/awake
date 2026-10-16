package wol

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/netip"
	"slices"
	"testing"
)

func TestMagicPacket(t *testing.T) {
	mac := [6]byte{0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}
	p := MagicPacket(mac)
	if len(p) != 102 {
		t.Fatalf("len = %d, want 102", len(p))
	}
	if !bytes.Equal(p[:6], []byte{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}) {
		t.Fatalf("header = % X", p[:6])
	}
	for i := range 16 {
		if !bytes.Equal(p[6+i*6:12+i*6], mac[:]) {
			t.Fatalf("repetition %d = % X", i, p[6+i*6:12+i*6])
		}
	}
}

func TestDirectedBroadcast(t *testing.T) {
	cases := map[string]string{
		"192.168.1.20/24": "192.168.1.255",
		"10.1.2.3/8":      "10.255.255.255",
		"172.16.5.4/20":   "172.16.15.255",
		"192.168.1.5/30":  "192.168.1.7",
	}
	for in, want := range cases {
		got, ok := DirectedBroadcast(netip.MustParsePrefix(in))
		if !ok || got.String() != want {
			t.Errorf("DirectedBroadcast(%s) = %v, %v; want %s", in, got, ok, want)
		}
	}
	for _, in := range []string{"192.168.1.1/32", "10.0.0.1/31", "127.0.0.1/8", "fe80::1/64"} {
		if _, ok := DirectedBroadcast(netip.MustParsePrefix(in)); ok {
			t.Errorf("DirectedBroadcast(%s) should not apply", in)
		}
	}
}

func TestTargetsDedup(t *testing.T) {
	s := &Sender{
		Port:  9,
		Auto:  true,
		Extra: []netip.Addr{netip.MustParseAddr("192.168.1.255"), netip.MustParseAddr("10.0.0.255")},
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		interfaceAddrs: func() ([]netip.Prefix, error) {
			return []netip.Prefix{netip.MustParsePrefix("192.168.1.20/24"), netip.MustParsePrefix("127.0.0.1/8")}, nil
		},
	}
	got := s.Targets()
	want := []netip.Addr{LimitedBroadcast, netip.MustParseAddr("192.168.1.255"), netip.MustParseAddr("10.0.0.255")}
	if !slices.Equal(got, want) {
		t.Fatalf("Targets = %v, want %v", got, want)
	}
}

func TestDryRunSendsNothing(t *testing.T) {
	var buf bytes.Buffer
	s := &Sender{Port: 9, DryRun: true, Log: slog.New(slog.NewTextHandler(&buf, nil))}
	if err := s.Wake(context.Background(), [6]byte{1, 2, 3, 4, 5, 6}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(buf.Bytes(), []byte("dry run")) || !bytes.Contains(buf.Bytes(), []byte("01:02:03:04:05:06")) {
		t.Fatalf("log = %s", buf.String())
	}
}
