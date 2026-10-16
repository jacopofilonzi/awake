package outputs

import (
	"log/slog"
)

// SimDriver provides virtual lines for machines without physical outputs (a PC). They only log, at
// debug level: the Manager already logs every press and switch change at info level, which is what a
// person watching a simulated agent wants to see.
type SimDriver struct {
	log *slog.Logger
}

// NewSimDriver returns the "sim" driver.
func NewSimDriver(log *slog.Logger) *SimDriver {
	return &SimDriver{log: log}
}

// Name implements Driver.
func (d *SimDriver) Name() string { return "sim" }

// Open implements Driver.
func (d *SimDriver) Open(spec Spec) (Line, error) {
	return &simLine{id: spec.ID, log: d.log}, nil
}

type simLine struct {
	id  string
	log *slog.Logger
}

func (l *simLine) SetActive(active bool) error {
	l.log.Debug("sim line set", "id", l.id, "active", active)
	return nil
}

func (l *simLine) Close() error { return nil }
