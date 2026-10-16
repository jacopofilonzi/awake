package protocol

import (
	"errors"
	"fmt"
	"net/netip"
	"time"
)

// Probe timeout bounds. The server sends `timeout` in milliseconds; values outside this range are
// clamped rather than rejected, because a slightly odd timeout is not worth failing a probe for, while
// an unbounded one could keep a goroutine busy for a long time.
const (
	MinProbeTimeout     = 100 * time.Millisecond
	MaxProbeTimeout     = 30 * time.Second
	DefaultProbeTimeout = 2 * time.Second
)

// ParseMAC parses a MAC in the exact wire format of §4.1: six uppercase hex bytes separated by `:`.
// Anything else (lowercase, `-` separators, EUI-64) is rejected: the server always normalizes MACs, so a
// different format means a broken or hostile peer.
func ParseMAC(s string) ([6]byte, error) {
	var mac [6]byte
	if len(s) != 17 {
		return mac, fmt.Errorf("mac %q: want 17 characters, got %d", s, len(s))
	}
	for i := range 6 {
		hi, okHi := upperHex(s[i*3])
		lo, okLo := upperHex(s[i*3+1])
		if !okHi || !okLo {
			return mac, fmt.Errorf("mac %q: byte %d is not two uppercase hex digits", s, i+1)
		}
		if i < 5 && s[i*3+2] != ':' {
			return mac, fmt.Errorf("mac %q: expected ':' after byte %d", s, i+1)
		}
		mac[i] = hi<<4 | lo
	}
	return mac, nil
}

func upperHex(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}

// ParseIPv4 parses a dotted-quad IPv4 address. IPv6 and IPv4-mapped IPv6 forms are rejected (§4.2
// specifies IPv4 only).
func ParseIPv4(s string) (netip.Addr, error) {
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}, fmt.Errorf("ip %q: %w", s, err)
	}
	if !addr.Is4() {
		return netip.Addr{}, fmt.Errorf("ip %q: not an IPv4 address", s)
	}
	return addr, nil
}

// ValidatePort checks a TCP port number.
func ValidatePort(p int) error {
	if p < 1 || p > 65535 {
		return fmt.Errorf("port %d out of range 1-65535", p)
	}
	return nil
}

// ProbeTimeout converts the optional `timeout` field (milliseconds) to a duration within
// [MinProbeTimeout, MaxProbeTimeout]; a missing value uses DefaultProbeTimeout.
func ProbeTimeout(ms *int) time.Duration {
	if ms == nil {
		return DefaultProbeTimeout
	}
	d := time.Duration(*ms) * time.Millisecond
	return min(max(d, MinProbeTimeout), MaxProbeTimeout)
}

// ErrInvalidOutputID is returned by ValidateOutputID.
var ErrInvalidOutputID = errors.New("output id must be 1-32 chars of a-z, 0-9, '-', '_', starting with a letter or digit")

// ValidateOutputID enforces the id rule of §3.
func ValidateOutputID(id string) error {
	if len(id) < 1 || len(id) > 32 {
		return ErrInvalidOutputID
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		alnum := (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		if alnum || (i > 0 && (c == '-' || c == '_')) {
			continue
		}
		return ErrInvalidOutputID
	}
	return nil
}
