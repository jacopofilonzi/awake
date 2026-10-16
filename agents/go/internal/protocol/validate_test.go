package protocol

import (
	"testing"
	"time"
)

func TestParseMAC(t *testing.T) {
	good := map[string][6]byte{
		"AA:BB:CC:DD:EE:FF": {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF},
		"00:11:22:33:44:55": {0x00, 0x11, 0x22, 0x33, 0x44, 0x55},
	}
	for in, want := range good {
		got, err := ParseMAC(in)
		if err != nil || got != want {
			t.Errorf("ParseMAC(%q) = %X, %v; want %X", in, got, err, want)
		}
	}
	bad := []string{
		"", "aa:bb:cc:dd:ee:ff", "AA-BB-CC-DD-EE-FF", "AA:BB:CC:DD:EE", "AA:BB:CC:DD:EE:FF:00",
		"AABBCCDDEEFF", "AA:BB:CC:DD:EE:FG", " AA:BB:CC:DD:EE:F", "AA:BB:CC:DD:EE:FF ",
	}
	for _, in := range bad {
		if _, err := ParseMAC(in); err == nil {
			t.Errorf("ParseMAC(%q) accepted", in)
		}
	}
}

func TestParseIPv4(t *testing.T) {
	for _, in := range []string{"192.168.1.20", "10.0.0.1", "127.0.0.1"} {
		if _, err := ParseIPv4(in); err != nil {
			t.Errorf("ParseIPv4(%q): %v", in, err)
		}
	}
	for _, in := range []string{"", "256.1.1.1", "1.2.3", "::1", "::ffff:1.2.3.4", "host.lan", "01.2.3.4", "1.2.3.4 "} {
		if _, err := ParseIPv4(in); err == nil {
			t.Errorf("ParseIPv4(%q) accepted", in)
		}
	}
}

func TestValidatePort(t *testing.T) {
	for _, p := range []int{1, 22, 65535} {
		if err := ValidatePort(p); err != nil {
			t.Errorf("port %d rejected: %v", p, err)
		}
	}
	for _, p := range []int{0, -1, 65536} {
		if err := ValidatePort(p); err == nil {
			t.Errorf("port %d accepted", p)
		}
	}
}

func TestProbeTimeout(t *testing.T) {
	ms := func(v int) *int { return &v }
	cases := []struct {
		in   *int
		want time.Duration
	}{
		{nil, DefaultProbeTimeout},
		{ms(2000), 2 * time.Second},
		{ms(0), MinProbeTimeout},
		{ms(-5), MinProbeTimeout},
		{ms(10_000_000), MaxProbeTimeout},
	}
	for _, c := range cases {
		if got := ProbeTimeout(c.in); got != c.want {
			t.Errorf("ProbeTimeout(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestValidateOutputID(t *testing.T) {
	for _, id := range []string{"a", "pc-power", "lamp_2", "0relay", "abcdefghijklmnopqrstuvwxyz012345"} {
		if err := ValidateOutputID(id); err != nil {
			t.Errorf("id %q rejected", id)
		}
	}
	for _, id := range []string{"", "-x", "_x", "PC", "pc power", "pc.power", "abcdefghijklmnopqrstuvwxyz0123456", "è"} {
		if err := ValidateOutputID(id); err == nil {
			t.Errorf("id %q accepted", id)
		}
	}
}
