//go:build !linux

package sysinfo

// readBoardModel reports no model: only Linux device-tree boards expose one.
func readBoardModel() (string, error) { return "", nil }
