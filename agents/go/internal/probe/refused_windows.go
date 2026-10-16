package probe

import (
	"errors"
	"syscall"
)

// wsaeconnrefused is WSAECONNREFUSED. On Windows the socket error is reported as this Winsock code,
// which is not the same value as syscall.ECONNREFUSED (an invented errno on this platform).
const wsaeconnrefused = syscall.Errno(10061)

func isRefused(err error) bool {
	return errors.Is(err, wsaeconnrefused) || errors.Is(err, syscall.ECONNREFUSED)
}
