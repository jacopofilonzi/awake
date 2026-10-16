package outputs

import (
	"fmt"
	"log/slog"
	"sort"
)

// Line is one physical output line, as opened by a Driver. It knows nothing about buttons, switches or
// durations: the Manager turns presses and switch changes into SetActive calls.
//
// Implementations must be safe for use by one goroutine at a time (the Manager serializes calls per
// line) and must return quickly: SetActive is called while the Manager holds its lock.
type Line interface {
	// SetActive energizes (true) or releases (false) the line: for a button, "pressed"; for a switch,
	// "on". Polarity (active-low relays…) is the driver's business.
	SetActive(active bool) error
	// Close releases the line's resources. The Manager releases the line (SetActive(false) for
	// buttons) before closing it.
	Close() error
}

// Spec is what a driver needs to open one line. Driver-specific settings (a GPIO pin number, active-low
// polarity…) will be added here when a hardware driver needs them.
type Spec struct {
	ID   string
	Mode string
}

// Driver opens lines of one kind (simulated, GPIO…).
type Driver interface {
	Name() string
	Open(spec Spec) (Line, error)
}

// Drivers maps a driver name (the `driver` key of an output in the config) to its implementation.
type Drivers map[string]Driver

// DefaultDrivers returns the drivers available in this build.
func DefaultDrivers(log *slog.Logger) Drivers {
	sim := NewSimDriver(log)
	return Drivers{sim.Name(): sim}
}

// Names lists the registered driver names, sorted, for error messages.
func (d Drivers) Names() []string {
	names := make([]string, 0, len(d))
	for n := range d {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Open opens a line with the named driver.
func (d Drivers) Open(driver string, spec Spec) (Line, error) {
	drv, ok := d[driver]
	if !ok {
		return nil, fmt.Errorf("output %q: unknown driver %q (available: %v)", spec.ID, driver, d.Names())
	}
	line, err := drv.Open(spec)
	if err != nil {
		return nil, fmt.Errorf("output %q: open with driver %q: %w", spec.ID, driver, err)
	}
	return line, nil
}
