package client

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/probe"
	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// handleCommand runs in its own goroutine. Replies go through the session queue; if the connection
// drops meanwhile the reply is lost, as the protocol requires (no replay across reconnections, §4).
func (c *Client) handleCommand(sess *session, t string, data []byte) {
	var cmd protocol.Command
	// encoding/json keeps decoding after a type mismatch, so the id is usually available even when
	// another field is malformed: that lets the agent answer "invalid" instead of staying silent.
	decodeErr := json.Unmarshal(data, &cmd)
	if cmd.ID == "" {
		c.log.Warn("ignoring command without a usable id", "t", t)
		return
	}
	log := c.log.With("t", t, "id", cmd.ID)
	if decodeErr != nil {
		log.Warn("invalid command", "err", decodeErr)
		c.reply(sess, invalidReply(t, cmd.ID))
		return
	}

	var reply any
	switch t {
	case protocol.TypeWake:
		reply = c.wake(sess.ctx, log, cmd)
	case protocol.TypeProbe:
		reply = c.probe(sess.ctx, log, cmd)
	case protocol.TypePress:
		reply = c.press(log, cmd)
	case protocol.TypeSet:
		reply = c.set(log, cmd)
	default:
		return
	}
	c.reply(sess, reply)
}

func (c *Client) reply(sess *session, msg any) {
	if err := sess.send(msg); err != nil {
		c.log.Warn("reply not sent", "err", err)
	}
}

func invalidReply(t, id string) any {
	if t == protocol.TypeProbe {
		return protocol.ProbeResult{T: protocol.TypeProbeResult, ID: id, Up: false, Err: protocol.ErrInvalid}
	}
	return nack(id, protocol.ErrInvalid)
}

func ack(id string) protocol.Ack {
	return protocol.Ack{T: protocol.TypeAck, ID: id, OK: true}
}

func nack(id, reason string) protocol.Ack {
	return protocol.Ack{T: protocol.TypeAck, ID: id, OK: false, Err: reason}
}

func (c *Client) wake(ctx context.Context, log *slog.Logger, cmd protocol.Command) any {
	mac, err := protocol.ParseMAC(cmd.MAC)
	if err != nil {
		log.Warn("invalid wake", "err", err)
		return nack(cmd.ID, protocol.ErrInvalid)
	}
	wctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	if err := c.opts.Waker.Wake(wctx, mac); err != nil {
		log.Error("wake failed", "mac", cmd.MAC, "err", err)
		return nack(cmd.ID, protocol.ErrSendFailed)
	}
	return ack(cmd.ID)
}

func (c *Client) probe(ctx context.Context, log *slog.Logger, cmd protocol.Command) any {
	result := protocol.ProbeResult{T: protocol.TypeProbeResult, ID: cmd.ID}
	ip, err := protocol.ParseIPv4(cmd.IP)
	if err != nil {
		log.Warn("invalid probe", "err", err)
		result.Err = protocol.ErrInvalid
		return result
	}
	port := 0
	if cmd.Port != nil {
		if err := protocol.ValidatePort(*cmd.Port); err != nil {
			log.Warn("invalid probe", "err", err)
			result.Err = protocol.ErrInvalid
			return result
		}
		port = *cmd.Port
	}
	timeout := protocol.ProbeTimeout(cmd.Timeout)
	pctx, cancel := context.WithTimeout(ctx, timeout+probeGrace)
	defer cancel()
	res, err := c.opts.Prober.Probe(pctx, ip, port, timeout)
	switch {
	case errors.Is(err, probe.ErrICMPUnsupported):
		log.Warn("icmp probe not possible on this host; configure a TCP port for the device", "ip", cmd.IP, "err", err)
		result.Err = protocol.ErrICMPUnsupported
	case err != nil:
		log.Warn("probe failed", "ip", cmd.IP, "port", port, "err", err)
		result.Err = protocol.ErrProbeFailed
	default:
		result.Up = res.Up
		if res.Up {
			ms := res.RTT.Milliseconds()
			result.MS = &ms
		}
		log.Debug("probe done", "ip", cmd.IP, "port", port, "up", res.Up, "rtt", res.RTT)
	}
	return result
}

func (c *Client) press(log *slog.Logger, cmd protocol.Command) any {
	if cmd.Out == "" {
		log.Warn("invalid press: missing out")
		return nack(cmd.ID, protocol.ErrInvalid)
	}
	long := cmd.Long != nil && *cmd.Long
	if _, err := c.opts.Outputs.Press(cmd.Out, long, outputs.CauseServer); err != nil {
		log.Warn("press rejected", "out", cmd.Out, "long", long, "err", err)
		return nack(cmd.ID, outputErr(err))
	}
	return ack(cmd.ID)
}

func (c *Client) set(log *slog.Logger, cmd protocol.Command) any {
	if cmd.Out == "" || cmd.On == nil {
		log.Warn("invalid set: missing out or on")
		return nack(cmd.ID, protocol.ErrInvalid)
	}
	on, err := c.opts.Outputs.Set(cmd.Out, *cmd.On, outputs.CauseServer)
	if err != nil {
		log.Warn("set rejected", "out", cmd.Out, "on", *cmd.On, "err", err)
		a := nack(cmd.ID, outputErr(err))
		// The current state is known only when the output exists and is a switch, i.e. the driver
		// failed (§4.4: "on set to the current state when the agent knows it").
		if errors.Is(err, outputs.ErrDriver) {
			a.On = &on
		}
		return a
	}
	a := ack(cmd.ID)
	a.On = &on
	return a
}

func outputErr(err error) string {
	switch {
	case errors.Is(err, outputs.ErrUnknownOutput):
		return protocol.ErrUnknownOutput
	case errors.Is(err, outputs.ErrWrongMode):
		return protocol.ErrWrongMode
	case errors.Is(err, outputs.ErrNoLongPress):
		return protocol.ErrNoLongPress
	case errors.Is(err, outputs.ErrBusy):
		return protocol.ErrBusy
	default:
		return protocol.ErrOutputFailed
	}
}
