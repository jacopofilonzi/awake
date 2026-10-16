// Package wol builds and broadcasts Wake-on-LAN magic packets (§9 of PROTOCOL.md).
//
// A packet is sent to the limited broadcast 255.255.255.255, to the directed broadcast of every local
// IPv4 subnet (when auto-detection is on) and to any configured extra address. Sending to several
// addresses matters in practice: some stacks and routers drop one kind of broadcast, and on a
// multi-homed host (e.g. Windows with a VPN adapter) the limited broadcast leaves through one interface
// only.
package wol

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"strings"
)

// PacketSize is the size of a magic packet: 6 × 0xFF followed by the MAC 16 times.
const PacketSize = 6 + 16*6

// MagicPacket builds the 102-byte magic packet for mac.
func MagicPacket(mac [6]byte) []byte {
	p := make([]byte, 0, PacketSize)
	for range 6 {
		p = append(p, 0xFF)
	}
	for range 16 {
		p = append(p, mac[:]...)
	}
	return p
}

// LimitedBroadcast is 255.255.255.255.
var LimitedBroadcast = netip.AddrFrom4([4]byte{255, 255, 255, 255})

// Sender broadcasts magic packets. The zero value is not usable: set Port at least.
type Sender struct {
	Port int
	// Extra are additional broadcast (or unicast) addresses from the config.
	Extra []netip.Addr
	// Auto adds the directed broadcast of every local IPv4 subnet, detected at each wake so that
	// interfaces coming and going (Wi-Fi, VPN) are picked up.
	Auto bool
	// DryRun logs the packet instead of sending it.
	DryRun bool
	Log    *slog.Logger
	// interfaceAddrs is replaceable in tests; nil means the real interfaces.
	interfaceAddrs func() ([]netip.Prefix, error)
}

// Targets returns the deduplicated destination addresses for a wake.
func (s *Sender) Targets() []netip.Addr {
	seen := map[netip.Addr]bool{}
	var out []netip.Addr
	add := func(a netip.Addr) {
		if !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	add(LimitedBroadcast)
	if s.Auto {
		bcasts, err := s.directedBroadcasts()
		if err != nil {
			// Not fatal: the limited broadcast and configured addresses still go out.
			s.Log.Warn("cannot list local interfaces for directed broadcasts", "err", err)
		}
		for _, b := range bcasts {
			add(b)
		}
	}
	for _, a := range s.Extra {
		add(a)
	}
	return out
}

// Wake sends the magic packet for mac to every target. It succeeds if at least one send succeeded:
// a single unreachable target (e.g. a stale configured subnet) must not fail the whole wake.
func (s *Sender) Wake(ctx context.Context, mac [6]byte) error {
	packet := MagicPacket(mac)
	targets := s.Targets()
	macStr := formatMAC(mac)
	if s.DryRun {
		s.Log.Info("dry run: magic packet not sent", "mac", macStr, "port", s.Port, "targets", targets)
		return nil
	}

	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		return fmt.Errorf("open udp socket: %w", err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			s.Log.Debug("close udp socket", "err", err)
		}
	}()
	// Go enables SO_BROADCAST on every IPv4 UDP socket, so no extra socket option is needed.
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetWriteDeadline(deadline); err != nil {
			return fmt.Errorf("set write deadline: %w", err)
		}
	}

	var sent []netip.Addr
	var errs []error
	for _, t := range targets {
		dst := net.UDPAddrFromAddrPort(netip.AddrPortFrom(t, uint16(s.Port)))
		if _, err := conn.WriteToUDP(packet, dst); err != nil {
			errs = append(errs, fmt.Errorf("send to %s: %w", dst, err))
			continue
		}
		sent = append(sent, t)
	}
	if len(sent) == 0 {
		return fmt.Errorf("magic packet for %s not sent: %w", macStr, errors.Join(errs...))
	}
	for _, e := range errs {
		s.Log.Warn("magic packet partly failed", "mac", macStr, "err", e)
	}
	s.Log.Info("magic packet sent", "mac", macStr, "port", s.Port, "targets", sent)
	return nil
}

func (s *Sender) directedBroadcasts() ([]netip.Addr, error) {
	list := s.interfaceAddrs
	if list == nil {
		list = localPrefixes
	}
	prefixes, err := list()
	var out []netip.Addr
	for _, p := range prefixes {
		if b, ok := DirectedBroadcast(p); ok {
			out = append(out, b)
		}
	}
	return out, err
}

// DirectedBroadcast returns ip | ^netmask for an IPv4 prefix. It reports false for prefixes without a
// meaningful broadcast (IPv6, /31, /32, loopback).
func DirectedBroadcast(p netip.Prefix) (netip.Addr, bool) {
	addr := p.Addr()
	if !addr.Is4() || p.Bits() > 30 || p.Bits() < 0 || addr.IsLoopback() {
		return netip.Addr{}, false
	}
	b := addr.As4()
	hostBits := 32 - p.Bits()
	v := uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
	v |= (1 << hostBits) - 1
	return netip.AddrFrom4([4]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}), true
}

// localPrefixes lists the IPv4 prefixes of the interfaces that are up and support broadcast.
func localPrefixes() ([]netip.Prefix, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("list interfaces: %w", err)
	}
	var out []netip.Prefix
	var errs []error
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagBroadcast == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			errs = append(errs, fmt.Errorf("addresses of %s: %w", iface.Name, err))
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip, ok := netip.AddrFromSlice(ipnet.IP)
			if !ok {
				continue
			}
			ip = ip.Unmap()
			ones, bits := ipnet.Mask.Size()
			if !ip.Is4() || bits == 0 {
				continue
			}
			if bits == 128 { // IPv4 address with a 16-byte mask
				ones -= 96
			}
			out = append(out, netip.PrefixFrom(ip, ones))
		}
	}
	return out, errors.Join(errs...)
}

func formatMAC(mac [6]byte) string {
	var sb strings.Builder
	for i, b := range mac {
		if i > 0 {
			sb.WriteByte(':')
		}
		fmt.Fprintf(&sb, "%02X", b)
	}
	return sb.String()
}
