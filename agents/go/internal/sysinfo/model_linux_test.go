package sysinfo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadModelFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "model")
	if err := os.WriteFile(path, []byte("Raspberry Pi 5 Model B Rev 1.0\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readModelFile(path)
	if err != nil || got != "Raspberry Pi 5 Model B Rev 1.0" {
		t.Fatalf("readModelFile = %q, %v", got, err)
	}
	// A PC has no device tree: no model, no error.
	got, err = readModelFile(filepath.Join(dir, "missing"))
	if err != nil || got != "" {
		t.Fatalf("missing file: %q, %v", got, err)
	}
}
