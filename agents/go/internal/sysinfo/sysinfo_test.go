package sysinfo

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestPlatform(t *testing.T) {
	cases := []struct{ goos, goarch, model, want string }{
		{"windows", "amd64", "", "windows/amd64"},
		{"linux", "arm64", "Raspberry Pi 4 Model B Rev 1.4", "linux/arm64 (Raspberry Pi 4 Model B Rev 1.4)"},
	}
	for _, c := range cases {
		if got := Platform(c.goos, c.goarch, c.model); got != c.want {
			t.Errorf("Platform(%q, %q, %q) = %q, want %q", c.goos, c.goarch, c.model, got, c.want)
		}
	}
	long := Platform("linux", "arm", strings.Repeat("è", 40))
	if len(long) > 64 || !strings.HasPrefix(long, "linux/arm (") {
		t.Errorf("long platform = %q (%d bytes)", long, len(long))
	}
	if !strings.HasSuffix(long, "è") {
		t.Errorf("long platform split a UTF-8 sequence: %q", long)
	}
}

func TestCleanModel(t *testing.T) {
	cases := map[string]string{
		"Raspberry Pi 4 Model B Rev 1.4\x00": "Raspberry Pi 4 Model B Rev 1.4",
		"Raspberry Pi Zero W Rev 1.1\n":      "Raspberry Pi Zero W Rev 1.1",
		"A\x00garbage":                       "A",
		"":                                   "",
		"\xff\xfe\x00":                       "",
	}
	for raw, want := range cases {
		if got := cleanModel([]byte(raw)); got != want {
			t.Errorf("cleanModel(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestCollect(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	model := func() (string, error) { return "Raspberry Pi 4 Model B Rev 1.4", nil }
	c := newCollector(quiet(), "linux", "arm64", model, clock, func() (string, error) { return "pi-sala", nil })
	now = now.Add(90*time.Second + 500*time.Millisecond)

	info := c.Collect(&net.TCPAddr{IP: net.IPv4(192, 168, 1, 50), Port: 51000})
	b, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"platform":"linux/arm64 (Raspberry Pi 4 Model B Rev 1.4)","host":"pi-sala","ip":"192.168.1.50","uptime":90}`
	if string(b) != want {
		t.Fatalf("info = %s, want %s", b, want)
	}
}

func TestCollectOmitsUnknown(t *testing.T) {
	failing := func() (string, error) { return "", errors.New("boom") }
	c := newCollector(quiet(), "windows", "amd64", failing, time.Now, failing)
	for _, local := range []net.Addr{
		nil,
		&net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)},
		&net.TCPAddr{IP: net.ParseIP("2001:db8::1")},
		&net.UnixAddr{Name: "x", Net: "unix"},
	} {
		b, err := json.Marshal(c.Collect(local))
		if err != nil {
			t.Fatal(err)
		}
		// Uptime is always known; ssid, rssi, reset and mem are never sent by this agent.
		if want := `{"platform":"windows/amd64","uptime":0}`; string(b) != want {
			t.Errorf("Collect(%v) = %s, want %s", local, b, want)
		}
	}

	long := newCollector(quiet(), "linux", "amd64", failing, time.Now,
		func() (string, error) { return strings.Repeat("h", 65), nil })
	if h := long.Collect(nil).Host; h != "" {
		t.Errorf("a hostname over 64 bytes must be omitted, got %q", h)
	}
}

func TestIPv4MappedAddress(t *testing.T) {
	// A dual-stack socket may report an IPv4 connection as ::ffff:a.b.c.d.
	if got := lanIPv4(&net.TCPAddr{IP: net.ParseIP("::ffff:10.0.0.7")}); got != "10.0.0.7" {
		t.Fatalf("lanIPv4 = %q", got)
	}
}
