package console

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jacopofilonzi/awake/agents/go/internal/client"
	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

func TestConsoleCommands(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	mgr, err := outputs.New([]outputs.Config{
		{ID: "pc-power", Mode: protocol.ModeButton, Driver: "sim", Short: 50 * time.Millisecond},
		{ID: "lamp", Mode: protocol.ModeSwitch, Driver: "sim"},
	}, outputs.DefaultDrivers(log), log)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := mgr.Close(); err != nil {
			t.Error(err)
		}
	}()
	var changes []outputs.Change
	mgr.SetOnChange(func(c outputs.Change) { changes = append(changes, c) })

	in := strings.NewReader("toggle lamp\noff lamp\non lamp\npress pc-power\npress pc-power\npress pc-power long\ntoggle pc-power\nstatus\nfrobnicate\n")
	var out bytes.Buffer
	c := &Console{In: in, Out: &out, Outputs: mgr, Server: "ws://x/agent", Log: log,
		Status: func() client.Status { return client.Status{Connected: true, Name: "n"} }}
	c.Run(context.Background()) // returns at EOF

	text := out.String()
	for _, want := range []string{
		"lamp is now on", "lamp is now off", "pc-power pressed for 50ms", "busy", "no long press",
		"wrong mode", `connected to ws://x/agent as "n"`, "lamp", "unknown command",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("output lacks %q:\n%s", want, text)
		}
	}
	if len(changes) != 3 || changes[0].Cause != outputs.CauseLocal {
		t.Errorf("changes = %+v", changes)
	}
}
