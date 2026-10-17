// Package sysinfo collects what a PC or Raspberry Pi agent knows about itself for the `info` field of
// hello and the periodic `info` message (PROTOCOL.md §5.2): platform, hostname, LAN IPv4 and uptime.
//
// Wi-Fi network, signal, free memory and reset reason are left out on purpose: they are mostly useful
// on microcontrollers, and on a PC each needs its own per-OS code for little value.
//
// Every field is best effort. A value that cannot be read is logged at debug level and left out (a
// missing field means "unknown"); collection never fails as a whole, so it can never break a connection.
//
// The platform string is computed once at startup (it cannot change while the process runs); hostname
// and uptime are read at each collection; the IP is the local address of the connection to the server,
// which only the client knows, so it is passed in.
package sysinfo

import (
	"log/slog"
	"net"
	"os"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// Collector builds protocol.Info values. Create it with New as early as possible: uptime counts from
// its creation, which stands for the start of the agent process.
type Collector struct {
	log      *slog.Logger
	start    time.Time
	platform string

	// Replaced by tests.
	now      func() time.Time
	hostname func() (string, error)
}

// New creates a collector for this machine.
func New(log *slog.Logger) *Collector {
	return newCollector(log, runtime.GOOS, runtime.GOARCH, readBoardModel, time.Now, os.Hostname)
}

func newCollector(log *slog.Logger, goos, goarch string, model func() (string, error), now func() time.Time, hostname func() (string, error)) *Collector {
	m, err := model()
	if err != nil {
		log.Debug("board model not available", "err", err)
		m = ""
	}
	return &Collector{
		log:      log,
		start:    now(),
		platform: Platform(goos, goarch, m),
		now:      now,
		hostname: hostname,
	}
}

// Platform formats the platform field: "goos/goarch", followed by the board model in parentheses when
// known (e.g. "linux/arm64 (Raspberry Pi 4 Model B Rev 1.4)"), cut to the protocol's maximum length.
func Platform(goos, goarch, model string) string {
	p := goos + "/" + goarch
	if model != "" {
		p += " (" + model + ")"
	}
	return truncate(p, protocol.MaxPlatformLen)
}

// cleanModel turns the raw content of a device-tree model file into a display string. The file is a
// C string: it ends with a NUL, which must not reach the JSON.
func cleanModel(raw []byte) string {
	s, _, _ := strings.Cut(string(raw), "\x00")
	s = strings.TrimSpace(s)
	if !utf8.ValidString(s) {
		return ""
	}
	return s
}

// Collect returns what is known now. local is the local address of the connection to the server (nil
// when unknown); it is reported only when it is a non-loopback IPv4 address, since the protocol's `ip`
// is the agent's IPv4 on its LAN.
func (c *Collector) Collect(local net.Addr) protocol.Info {
	info := protocol.Info{Platform: c.platform}

	switch host, err := c.hostname(); {
	case err != nil:
		c.log.Debug("hostname not available", "err", err)
	case host == "":
	case len(host) > protocol.MaxHostLen:
		// The server would ignore it; a cut hostname would be misleading, so leave it out.
		c.log.Debug("hostname too long for info; omitted", "host", host)
	default:
		info.Host = host
	}

	info.IP = lanIPv4(local)

	up := int64(c.now().Sub(c.start) / time.Second)
	if up < 0 {
		up = 0 // the wall clock went backwards (NTP step); monotonic time normally prevents it
	}
	info.Uptime = &up
	return info
}

// lanIPv4 extracts a non-loopback IPv4 address from a connection's local address.
func lanIPv4(addr net.Addr) string {
	var ip net.IP
	switch a := addr.(type) {
	case *net.TCPAddr:
		ip = a.IP
	case *net.UDPAddr:
		ip = a.IP
	default:
		return ""
	}
	v4 := ip.To4()
	if v4 == nil || v4.IsLoopback() || v4.IsUnspecified() {
		return ""
	}
	return v4.String()
}

// truncate cuts s to at most n bytes without splitting a UTF-8 sequence.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
