// Package outputs owns the agent's outputs (§1 of PROTOCOL.md): buttons that are pressed for a while
// and switches that stay on or off.
//
// The Manager holds the protocol-level state (which button is being pressed, each switch's on/off) and
// drives the physical lines through a Driver. Drivers are deliberately dumb ("make this line active or
// not") so that a hardware driver (e.g. Raspberry Pi GPIO) can be added without touching the press/busy
// logic or the protocol code.
//
// Every state change happens under one mutex. Switch changes are reported to a single callback, invoked
// with that mutex held, so that callers see changes in the exact order they happened; WithSnapshot runs
// a function under the same mutex, which lets the client compare a snapshot with later changes without
// missing or reordering any.
package outputs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// Config describes one output, already validated by the config package.
type Config struct {
	ID     string
	Mode   string // protocol.ModeButton or protocol.ModeSwitch
	Driver string
	// Short and Long are the press durations of a button; Long == 0 means no long press.
	Short time.Duration
	Long  time.Duration
	// Initial is the state a switch is put in at startup.
	Initial bool
}

// Cause tells who changed an output. The client uses it to report only changes not caused by a `set`
// command (§5.1).
type Cause string

const (
	CauseServer Cause = "server"
	CauseLocal  Cause = "local"
)

// Change is a switch state change.
type Change struct {
	ID    string
	On    bool
	Cause Cause
}

// State is a point-in-time view of one output.
type State struct {
	ID      string
	Mode    string
	HasLong bool // buttons only
	On      bool // switches only
	Busy    bool // buttons only: a press is in progress
}

// Errors returned by Press and Set. They map one-to-one to the protocol's `err` values in the client.
var (
	ErrUnknownOutput = errors.New("unknown output")
	ErrWrongMode     = errors.New("wrong mode")
	ErrNoLongPress   = errors.New("no long press configured")
	ErrBusy          = errors.New("output is being pressed")
	ErrClosed        = errors.New("outputs are shut down")
	// ErrDriver wraps an error returned by the output driver.
	ErrDriver = errors.New("output driver failed")
)

type output struct {
	cfg      Config
	line     Line
	on       bool
	pressing bool
}

// Manager drives the outputs. Create it with New and release it with Close.
type Manager struct {
	log *slog.Logger

	mu       sync.Mutex
	outs     map[string]*output
	order    []string // config order, so hello and status list outputs predictably
	onChange func(Change)
	closed   bool

	// ctx is cancelled by Close so that presses in progress are released immediately.
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// New opens a line for every output and puts it in its initial state (buttons released, switches at
// their configured initial value).
func New(cfgs []Config, drivers Drivers, log *slog.Logger) (*Manager, error) {
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{log: log, outs: make(map[string]*output, len(cfgs)), ctx: ctx, cancel: cancel}
	for _, c := range cfgs {
		if _, dup := m.outs[c.ID]; dup {
			m.closeLines()
			cancel()
			return nil, fmt.Errorf("output %q: duplicate id", c.ID)
		}
		line, err := drivers.Open(c.Driver, Spec{ID: c.ID, Mode: c.Mode})
		if err != nil {
			m.closeLines()
			cancel()
			return nil, err
		}
		o := &output{cfg: c, line: line}
		m.outs[c.ID] = o
		m.order = append(m.order, c.ID)
		initial := c.Mode == protocol.ModeSwitch && c.Initial
		if err := line.SetActive(initial); err != nil {
			m.closeLines()
			cancel()
			return nil, fmt.Errorf("output %q: set initial state: %w", c.ID, err)
		}
		o.on = initial
	}
	return m, nil
}

// SetOnChange registers the callback for switch changes. It runs with the Manager's lock held: it must
// return quickly and must not call back into the Manager.
func (m *Manager) SetOnChange(fn func(Change)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onChange = fn
}

// Press starts a short or long press of a button and returns its duration. It returns as soon as the
// line is active (the protocol acks when the press starts, §4.3); the release happens in the background.
func (m *Manager) Press(id string, long bool, cause Cause) (time.Duration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return 0, ErrClosed
	}
	o, ok := m.outs[id]
	if !ok {
		return 0, ErrUnknownOutput
	}
	if o.cfg.Mode != protocol.ModeButton {
		return 0, ErrWrongMode
	}
	if long && o.cfg.Long == 0 {
		return 0, ErrNoLongPress
	}
	if o.pressing {
		return 0, ErrBusy
	}
	d, kind := o.cfg.Short, "short"
	if long {
		d, kind = o.cfg.Long, "long"
	}
	if err := o.line.SetActive(true); err != nil {
		return 0, fmt.Errorf("%w: press %q: %w", ErrDriver, id, err)
	}
	o.pressing = true
	m.log.Info("output pressed", "id", id, "press", kind, "duration", d, "cause", cause)

	m.wg.Add(1)
	go m.releaseAfter(o, d)
	return d, nil
}

func (m *Manager) releaseAfter(o *output, d time.Duration) {
	defer m.wg.Done()
	timer := time.NewTimer(d)
	defer timer.Stop()
	reason := "done"
	select {
	case <-timer.C:
	case <-m.ctx.Done():
		reason = "shutdown"
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	// The output is marked free even if the release fails: keeping it busy forever would only hide the
	// problem, and the error below is what the owner needs to see.
	o.pressing = false
	if err := o.line.SetActive(false); err != nil {
		m.log.Error("output release failed", "id", o.cfg.ID, "err", err)
		return
	}
	m.log.Info("output released", "id", o.cfg.ID, "reason", reason)
}

// Set turns a switch on or off and returns its resulting state. Setting the current state is not an
// error and reports no change. On failure the returned state is the current one.
func (m *Manager) Set(id string, on bool, cause Cause) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, err := m.switchLocked(id)
	if err != nil {
		return false, err
	}
	return m.setLocked(o, on, cause)
}

// Toggle inverts a switch and returns its new state.
func (m *Manager) Toggle(id string, cause Cause) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, err := m.switchLocked(id)
	if err != nil {
		return false, err
	}
	return m.setLocked(o, !o.on, cause)
}

func (m *Manager) switchLocked(id string) (*output, error) {
	if m.closed {
		return nil, ErrClosed
	}
	o, ok := m.outs[id]
	if !ok {
		return nil, ErrUnknownOutput
	}
	if o.cfg.Mode != protocol.ModeSwitch {
		return nil, ErrWrongMode
	}
	return o, nil
}

func (m *Manager) setLocked(o *output, on bool, cause Cause) (bool, error) {
	if o.on == on {
		m.log.Debug("switch unchanged", "id", o.cfg.ID, "on", on, "cause", cause)
		return on, nil
	}
	if err := o.line.SetActive(on); err != nil {
		return o.on, fmt.Errorf("%w: set %q: %w", ErrDriver, o.cfg.ID, err)
	}
	o.on = on
	m.log.Info("switch changed", "id", o.cfg.ID, "on", on, "cause", cause)
	if m.onChange != nil {
		m.onChange(Change{ID: o.cfg.ID, On: on, Cause: cause})
	}
	return on, nil
}

// Snapshot returns the current state of every output, in config order.
func (m *Manager) Snapshot() []State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

// WithSnapshot calls fn with the current states while holding the lock, so no change can happen (nor
// be reported to the OnChange callback) until fn returns. fn must not call back into the Manager.
func (m *Manager) WithSnapshot(fn func([]State)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fn(m.snapshotLocked())
}

func (m *Manager) snapshotLocked() []State {
	states := make([]State, 0, len(m.order))
	for _, id := range m.order {
		o := m.outs[id]
		states = append(states, State{
			ID:      id,
			Mode:    o.cfg.Mode,
			HasLong: o.cfg.Long > 0,
			On:      o.on,
			Busy:    o.pressing,
		})
	}
	return states
}

// Close releases every button being pressed, then closes all lines. Switches are left as they are: the
// driver decides what a closed line does (the sim driver does nothing).
func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	m.mu.Unlock()

	m.cancel()
	m.wg.Wait()

	m.mu.Lock()
	defer m.mu.Unlock()
	return m.closeLines()
}

func (m *Manager) closeLines() error {
	var errs []error
	for _, id := range m.order {
		if err := m.outs[id].line.Close(); err != nil {
			errs = append(errs, fmt.Errorf("close output %q: %w", id, err))
		}
	}
	return errors.Join(errs...)
}
