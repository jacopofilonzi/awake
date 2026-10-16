package outputs

import (
	"errors"
	"io"
	"log/slog"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// recordingDriver records every SetActive call, so tests can check what reached the "hardware".
type recordingDriver struct {
	mu    sync.Mutex
	calls []string
	fail  bool
}

func (d *recordingDriver) Name() string { return "rec" }

func (d *recordingDriver) Open(spec Spec) (Line, error) {
	return &recordingLine{id: spec.ID, d: d}, nil
}

type recordingLine struct {
	id string
	d  *recordingDriver
}

func (l *recordingLine) SetActive(active bool) error {
	l.d.mu.Lock()
	defer l.d.mu.Unlock()
	if l.d.fail {
		return errors.New("boom")
	}
	state := "off"
	if active {
		state = "on"
	}
	l.d.calls = append(l.d.calls, l.id+"="+state)
	return nil
}

func (l *recordingLine) Close() error { return nil }

func (d *recordingDriver) snapshot() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.calls...)
}

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newTestManager(t *testing.T) (*Manager, *recordingDriver) {
	t.Helper()
	drv := &recordingDriver{}
	m, err := New([]Config{
		{ID: "pc-power", Mode: protocol.ModeButton, Driver: "rec", Short: 50 * time.Millisecond, Long: 100 * time.Millisecond},
		{ID: "nas-power", Mode: protocol.ModeButton, Driver: "rec", Short: 50 * time.Millisecond},
		{ID: "lamp", Mode: protocol.ModeSwitch, Driver: "rec", Initial: true},
	}, Drivers{"rec": drv}, quietLogger())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() {
		if err := m.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return m, drv
}

func TestInitialStates(t *testing.T) {
	m, drv := newTestManager(t)
	want := []string{"pc-power=off", "nas-power=off", "lamp=on"}
	if got := drv.snapshot(); !slices.Equal(got, want) {
		t.Fatalf("initial driver calls = %v, want %v", got, want)
	}
	states := m.Snapshot()
	if len(states) != 3 || states[0].ID != "pc-power" || !states[0].HasLong || states[1].HasLong || !states[2].On {
		t.Fatalf("unexpected snapshot %+v", states)
	}
}

func TestPressBusyAndRelease(t *testing.T) {
	m, drv := newTestManager(t)
	d, err := m.Press("pc-power", false, CauseServer)
	if err != nil || d != 50*time.Millisecond {
		t.Fatalf("Press = %v, %v", d, err)
	}
	if _, err := m.Press("pc-power", true, CauseLocal); !errors.Is(err, ErrBusy) {
		t.Fatalf("second press: got %v, want ErrBusy", err)
	}
	// Another button is independent.
	if _, err := m.Press("nas-power", false, CauseServer); err != nil {
		t.Fatalf("press other button: %v", err)
	}
	waitFor(t, func() bool { return !m.Snapshot()[0].Busy })
	if _, err := m.Press("pc-power", true, CauseServer); err != nil {
		t.Fatalf("press after release: %v", err)
	}
	waitFor(t, func() bool { return !m.Snapshot()[0].Busy })
	calls := drv.snapshot()
	if count(calls, "pc-power=on") != 2 || count(calls, "pc-power=off") != 3 {
		t.Fatalf("driver calls = %v", calls)
	}
}

func TestPressErrors(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Press("nas-power", true, CauseServer); !errors.Is(err, ErrNoLongPress) {
		t.Errorf("long press without long_ms: %v", err)
	}
	if _, err := m.Press("lamp", false, CauseServer); !errors.Is(err, ErrWrongMode) {
		t.Errorf("press on switch: %v", err)
	}
	if _, err := m.Press("nope", false, CauseServer); !errors.Is(err, ErrUnknownOutput) {
		t.Errorf("press unknown: %v", err)
	}
}

func TestSwitchEvents(t *testing.T) {
	m, _ := newTestManager(t)
	var mu sync.Mutex
	var events []Change
	m.SetOnChange(func(c Change) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, c)
	})

	if on, err := m.Set("lamp", true, CauseServer); err != nil || !on {
		t.Fatalf("Set same state = %v, %v", on, err)
	}
	if on, err := m.Set("lamp", false, CauseServer); err != nil || on {
		t.Fatalf("Set off = %v, %v", on, err)
	}
	if on, err := m.Toggle("lamp", CauseLocal); err != nil || !on {
		t.Fatalf("Toggle = %v, %v", on, err)
	}
	if _, err := m.Set("pc-power", true, CauseServer); !errors.Is(err, ErrWrongMode) {
		t.Errorf("set on button: %v", err)
	}
	if _, err := m.Toggle("nope", CauseLocal); !errors.Is(err, ErrUnknownOutput) {
		t.Errorf("toggle unknown: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	want := []Change{{"lamp", false, CauseServer}, {"lamp", true, CauseLocal}}
	if len(events) != len(want) || events[0] != want[0] || events[1] != want[1] {
		t.Fatalf("events = %+v, want %+v", events, want)
	}
}

func TestDriverFailureKeepsState(t *testing.T) {
	m, drv := newTestManager(t)
	drv.mu.Lock()
	drv.fail = true
	drv.mu.Unlock()
	on, err := m.Set("lamp", false, CauseServer)
	if !errors.Is(err, ErrDriver) || !on {
		t.Fatalf("Set with failing driver = %v, %v; want true, ErrDriver", on, err)
	}
	if _, err := m.Press("pc-power", false, CauseServer); !errors.Is(err, ErrDriver) {
		t.Fatalf("Press with failing driver: %v", err)
	}
	if m.Snapshot()[0].Busy {
		t.Fatal("failed press left the button busy")
	}
	drv.mu.Lock()
	drv.fail = false
	drv.mu.Unlock()
}

func TestCloseReleasesPressedButton(t *testing.T) {
	drv := &recordingDriver{}
	m, err := New([]Config{{ID: "b", Mode: protocol.ModeButton, Driver: "rec", Short: time.Hour}}, Drivers{"rec": drv}, quietLogger())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Press("b", false, CauseServer); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		if err := m.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not release the pressed button")
	}
	if got := drv.snapshot(); got[len(got)-1] != "b=off" {
		t.Fatalf("last driver call = %v, want b=off", got)
	}
	if _, err := m.Press("b", false, CauseServer); !errors.Is(err, ErrClosed) {
		t.Fatalf("press after close: %v", err)
	}
}

func TestUnknownDriver(t *testing.T) {
	_, err := New([]Config{{ID: "x", Mode: protocol.ModeSwitch, Driver: "gpio"}}, DefaultDrivers(quietLogger()), quietLogger())
	if err == nil {
		t.Fatal("unknown driver accepted")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func count(list []string, s string) int {
	n := 0
	for _, v := range list {
		if v == s {
			n++
		}
	}
	return n
}
