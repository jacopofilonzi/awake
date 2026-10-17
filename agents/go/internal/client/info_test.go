package client

import (
	"net"
	"sync"
	"testing"
	"time"

	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// fakeInfo returns a fixed description whose uptime counts the calls, and records the local addresses
// it was given.
type fakeInfo struct {
	mu     sync.Mutex
	locals []net.Addr
	empty  bool
}

func (f *fakeInfo) Collect(local net.Addr) protocol.Info {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.locals = append(f.locals, local)
	if f.empty {
		return protocol.Info{}
	}
	up := int64(len(f.locals))
	return protocol.Info{Platform: "testos/testarch", Host: "test-host", Uptime: &up}
}

func (f *fakeInfo) firstLocal() net.Addr {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.locals) == 0 {
		return nil
	}
	return f.locals[0]
}

func withInfo(src InfoSource, every time.Duration) func(*Client) {
	return func(c *Client) {
		c.opts.Info = src
		c.infoEvery = every
	}
}

func TestHelloCarriesInfo(t *testing.T) {
	src := &fakeInfo{}
	h := start(t, withInfo(src, time.Hour))
	hello := h.fs.accept().handshake(100)

	info, ok := hello["info"].(map[string]any)
	if !ok {
		t.Fatalf("hello has no info: %v", hello)
	}
	if info["platform"] != "testos/testarch" || info["host"] != "test-host" || info["uptime"] != float64(1) {
		t.Fatalf("hello info = %v", info)
	}
	for _, absent := range []string{"t", "ip", "ssid", "rssi", "reset", "mem"} {
		if _, ok := info[absent]; ok {
			t.Errorf("hello info has %q: %v", absent, info)
		}
	}
	// The source gets the local address of the connection to the server (loopback in this test).
	local, ok := src.firstLocal().(*net.TCPAddr)
	if !ok || !local.IP.IsLoopback() || local.Port == 0 {
		t.Fatalf("local address passed to the info source = %#v", src.firstLocal())
	}
}

func TestInfoSentOnInterval(t *testing.T) {
	h := start(t, withInfo(&fakeInfo{}, 30*time.Millisecond))
	sc := h.fs.accept()
	sc.handshake(100) // hb 1 s: the messages below are not heartbeats
	for _, want := range []float64{2, 3} {
		m := sc.read()
		if m["t"] != protocol.TypeInfo || m["platform"] != "testos/testarch" || m["uptime"] != want {
			t.Fatalf("got %v, want info with uptime %v", m, want)
		}
		if _, nested := m["info"]; nested {
			t.Fatalf("info fields must be at the top level: %v", m)
		}
	}
}

func TestNoInfoWhenUnknown(t *testing.T) {
	for name, configure := range map[string]func(*Client){
		"no source":    func(*Client) {},
		"empty source": withInfo(&fakeInfo{empty: true}, 20*time.Millisecond),
	} {
		t.Run(name, func(t *testing.T) {
			h := start(t, configure)
			sc := h.fs.accept()
			hello := sc.handshake(100)
			if _, ok := hello["info"]; ok {
				t.Fatalf("hello has info: %v", hello)
			}
			// Several info intervals pass: nothing is sent.
			if m, err := sc.readRaw(150 * time.Millisecond); err == nil {
				t.Fatalf("unexpected message: %v", m)
			}
		})
	}
}
