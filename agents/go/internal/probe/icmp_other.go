//go:build !windows

package probe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"sync"
	"time"

	probing "github.com/prometheus-community/pro-bing"
)

// icmpPinger remembers which socket kind worked, so that after the first probe each echo needs a
// single attempt. Unprivileged ("udp") ICMP sockets work on macOS and on Linux when
// net.ipv4.ping_group_range includes the agent's group; raw sockets need root or CAP_NET_RAW.
type icmpPinger struct {
	log *slog.Logger

	mu sync.Mutex
	// privileged is nil until a socket kind has worked once.
	privileged *bool
}

func (p *icmpPinger) ping(ctx context.Context, ip netip.Addr, timeout time.Duration) (Result, error) {
	p.mu.Lock()
	known := p.privileged
	p.mu.Unlock()

	candidates := []bool{false, true}
	if known != nil {
		candidates = []bool{*known}
	}
	var errs []error
	for _, privileged := range candidates {
		res, sendFailed, err := p.pingOnce(ctx, ip, timeout, privileged)
		if err == nil || sendFailed {
			p.mu.Lock()
			p.privileged = &privileged
			p.mu.Unlock()
			// A send error ("no route to host"…) means the socket works but the host is not reachable.
			return res, nil
		}
		errs = append(errs, fmt.Errorf("privileged=%v: %w", privileged, err))
	}
	return Result{}, fmt.Errorf("%w: %w", ErrICMPUnsupported, errors.Join(errs...))
}

// pingOnce sends one echo. sendFailed reports that the socket opened but the echo could not be sent,
// which tells "host unreachable" apart from "cannot open an ICMP socket".
func (p *icmpPinger) pingOnce(ctx context.Context, ip netip.Addr, timeout time.Duration, privileged bool) (res Result, sendFailed bool, err error) {
	pinger := probing.New(ip.String())
	pinger.SetIPAddr(ipAddr(ip))
	pinger.SetPrivileged(privileged)
	pinger.SetLogger(probingLogger{p.logger()})
	pinger.Count = 1
	pinger.Timeout = timeout
	var mu sync.Mutex
	pinger.OnSendError = func(_ *probing.Packet, _ error) {
		mu.Lock()
		sendFailed = true
		mu.Unlock()
	}
	runErr := pinger.RunWithContext(ctx)
	mu.Lock()
	defer mu.Unlock()
	if runErr != nil {
		return Result{}, sendFailed, runErr
	}
	stats := pinger.Statistics()
	if stats.PacketsRecv > 0 && len(stats.Rtts) > 0 {
		return Result{Up: true, RTT: stats.Rtts[0]}, false, nil
	}
	return Result{Up: false}, false, nil
}

func ipAddr(ip netip.Addr) *net.IPAddr {
	return &net.IPAddr{IP: ip.AsSlice()}
}

func (p *icmpPinger) logger() *slog.Logger {
	if p.log == nil {
		return slog.Default()
	}
	return p.log
}

// probingLogger routes pro-bing's own messages to slog.
type probingLogger struct{ log *slog.Logger }

func (l probingLogger) Fatalf(format string, v ...any) {
	l.log.Error("pro-bing: " + fmt.Sprintf(format, v...))
}
func (l probingLogger) Errorf(format string, v ...any) {
	l.log.Warn("pro-bing: " + fmt.Sprintf(format, v...))
}
func (l probingLogger) Warnf(format string, v ...any) {
	l.log.Debug("pro-bing: " + fmt.Sprintf(format, v...))
}
func (l probingLogger) Infof(format string, v ...any) {
	l.log.Debug("pro-bing: " + fmt.Sprintf(format, v...))
}
func (l probingLogger) Debugf(format string, v ...any) {
	l.log.Debug("pro-bing: " + fmt.Sprintf(format, v...))
}
