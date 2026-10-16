// Package console simulates the physical side of the agent from stdin: local switch buttons
// (toggle/on/off), local presses of a button output, and a status view.
//
// It talks only to the outputs Manager, exactly like a physical button wired to the agent would:
// switch changes therefore reach the server as out_state through the normal path, and a local press
// makes the button busy for server presses too.
package console

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/jacopofilonzi/awake/agents/go/internal/client"
	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// Console reads commands from In and writes answers to Out.
type Console struct {
	In      io.Reader
	Out     io.Writer
	Outputs *outputs.Manager
	Status  func() client.Status
	Server  string
	Log     *slog.Logger
}

const help = `commands:
  toggle <id>        flip a switch, as a local button would (sent as out_state when connected)
  on <id>            turn a switch on locally
  off <id>           turn a switch off locally
  press <id> [long]  press a button output locally (nothing is sent to the server)
  status             show the connection and every output
  help               show this help
`

// Run processes lines until In is exhausted or ctx is done. EOF only ends the console, never the
// agent: running with stdin closed (a service, `< /dev/null`) is normal.
func (c *Console) Run(ctx context.Context) {
	c.say("console ready; type 'help' for commands\n")
	scanner := bufio.NewScanner(c.In)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		c.Exec(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		c.Log.Warn("console input failed; console disabled", "err", err)
		return
	}
	c.Log.Debug("console input closed")
}

// Exec runs one command line.
func (c *Console) Exec(line string) {
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return
	}
	cmd, args := strings.ToLower(fields[0]), fields[1:]
	switch {
	case cmd == "help":
		c.say(help)
	case cmd == "status" && len(args) == 0:
		c.status()
	case (cmd == "toggle" || cmd == "on" || cmd == "off") && len(args) == 1:
		c.setSwitch(cmd, args[0])
	case cmd == "press" && (len(args) == 1 || (len(args) == 2 && strings.EqualFold(args[1], "long"))):
		c.press(args[0], len(args) == 2)
	default:
		c.say("unknown command %q\n%s", line, help)
	}
}

func (c *Console) setSwitch(cmd, id string) {
	var on bool
	var err error
	switch cmd {
	case "toggle":
		on, err = c.Outputs.Toggle(id, outputs.CauseLocal)
	default:
		on, err = c.Outputs.Set(id, cmd == "on", outputs.CauseLocal)
	}
	if err != nil {
		c.say("%s %s: %s\n", cmd, id, describe(err))
		return
	}
	c.say("%s is now %s\n", id, onOff(on))
}

func (c *Console) press(id string, long bool) {
	d, err := c.Outputs.Press(id, long, outputs.CauseLocal)
	if err != nil {
		c.say("press %s: %s\n", id, describe(err))
		return
	}
	c.say("%s pressed for %v\n", id, d)
}

func (c *Console) status() {
	st := c.Status()
	switch {
	case st.Connected:
		c.say("connection: connected to %s as %q since %s\n", c.Server, st.Name, st.Since.Format(time.TimeOnly))
	case !st.NextRetry.IsZero() && time.Until(st.NextRetry) > 0:
		c.say("connection: disconnected, next attempt in %v", time.Until(st.NextRetry).Round(time.Second))
		if st.LastError != "" {
			c.say(" (last error: %s)", st.LastError)
		}
		c.say("\n")
	default:
		c.say("connection: connecting to %s\n", c.Server)
	}

	states := c.Outputs.Snapshot()
	if len(states) == 0 {
		c.say("outputs: none\n")
		return
	}
	c.say("outputs:\n")
	tw := tabwriter.NewWriter(c.Out, 0, 4, 2, ' ', 0)
	for _, s := range states {
		var state string
		if s.Mode == protocol.ModeSwitch {
			state = onOff(s.On)
		} else {
			state = "idle"
			if s.Busy {
				state = "pressing"
			}
			if s.HasLong {
				state += "\t(long press available)"
			}
		}
		if _, err := fmt.Fprintf(tw, "  %s\t%s\t%s\n", s.ID, s.Mode, state); err != nil {
			c.Log.Warn("console write failed", "err", err)
			return
		}
	}
	if err := tw.Flush(); err != nil {
		c.Log.Warn("console write failed", "err", err)
	}
}

func (c *Console) say(format string, args ...any) {
	if _, err := fmt.Fprintf(c.Out, format, args...); err != nil {
		c.Log.Warn("console write failed", "err", err)
	}
}

func describe(err error) string {
	switch {
	case errors.Is(err, outputs.ErrUnknownOutput):
		return "no such output (see 'status')"
	case errors.Is(err, outputs.ErrWrongMode):
		return "wrong mode for this command (toggle/on/off are for switches, press for buttons)"
	case errors.Is(err, outputs.ErrNoLongPress):
		return "no long press configured (set long_ms)"
	case errors.Is(err, outputs.ErrBusy):
		return "busy: already being pressed"
	default:
		return err.Error()
	}
}

func onOff(on bool) string {
	if on {
		return "on"
	}
	return "off"
}
