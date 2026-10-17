package sysinfo

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
)

// modelPath is where Linux exposes the board model on device-tree systems (Raspberry Pi and most ARM
// boards). PCs have no device tree: the file is simply absent.
const modelPath = "/proc/device-tree/model"

func readBoardModel() (string, error) {
	return readModelFile(modelPath)
}

func readModelFile(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read board model: %w", err)
	}
	return cleanModel(raw), nil
}
