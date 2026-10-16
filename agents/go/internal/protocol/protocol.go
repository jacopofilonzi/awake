// Package protocol mirrors the Awake agent protocol v1 (docs/PROTOCOL.md): message shapes, close codes
// and the validation rules for values that arrive from the server.
//
// It is deliberately free of I/O so that both the client and the tests can use it. Field names and
// JSON tags must match PROTOCOL.md exactly: the server is written in another language and shares no code.
package protocol

// Version is the protocol version this agent implements (sent as `v` in hello).
const Version = 1

// MaxMessageSize is the largest message (one text frame) either side may send (§2).
const MaxMessageSize = 8 * 1024

// MaxOutputs is the maximum number of outputs an agent may declare in hello (§3).
const MaxOutputs = 32

// MaxFirmwareLen is the maximum length of the `fw` field in hello (§3).
const MaxFirmwareLen = 64

// Message types (`t`).
const (
	TypeHello       = "hello"
	TypeWelcome     = "welcome"
	TypeHeartbeat   = "hb"
	TypeWake        = "wake"
	TypeProbe       = "probe"
	TypePress       = "press"
	TypeSet         = "set"
	TypeAck         = "ack"
	TypeProbeResult = "probe_result"
	TypeOutState    = "out_state"
)

// Output modes (§1).
const (
	ModeButton = "button"
	ModeSwitch = "switch"
)

// Close codes sent by the server (§7). Standard WebSocket codes (1000, 1001, 1006…) are not listed:
// they all mean "reconnect with the normal backoff".
const (
	CloseProtocolError      = 4000
	CloseUnknownToken       = 4001
	CloseReplaced           = 4002
	CloseRevoked            = 4003
	CloseVersionUnsupported = 4004
	CloseNoHello            = 4008
	CloseTooManyAttempts    = 4029
)

// Recommended `err` values for ack and probe_result (§4, §4.2).
const (
	ErrUnknownOutput   = "unknown output"
	ErrWrongMode       = "wrong mode"
	ErrNoLongPress     = "no long press"
	ErrBusy            = "busy"
	ErrSendFailed      = "send failed"
	ErrInvalid         = "invalid"
	ErrICMPUnsupported = "icmp unsupported"
	// ErrOutputFailed is not in the recommended list: it reports that the output driver itself failed
	// (e.g. a GPIO write error), which none of the recommended values describe.
	ErrOutputFailed = "output failed"
	// ErrProbeFailed reports that a probe could not be performed for a reason other than missing ICMP
	// support.
	ErrProbeFailed = "probe failed"
)

// Envelope is the part common to every message, decoded first to route a message by its type.
type Envelope struct {
	T string `json:"t"`
}

// OutputInfo describes one output in hello (§3).
type OutputInfo struct {
	ID   string `json:"id"`
	Mode string `json:"mode"`
	// Long is set only for buttons; nil omits it (switches).
	Long *bool `json:"long,omitempty"`
	// On is set only for switches; it is required there, so nil means "not a switch".
	On *bool `json:"on,omitempty"`
}

// Hello is the first message of every connection (§3).
type Hello struct {
	T       string       `json:"t"`
	V       int          `json:"v"`
	Token   string       `json:"token"`
	FW      string       `json:"fw,omitempty"`
	Outputs []OutputInfo `json:"outputs,omitempty"`
}

// Welcome is the server's answer to a valid hello (§3).
type Welcome struct {
	T    string `json:"t"`
	V    int    `json:"v"`
	Name string `json:"name"`
	HB   int    `json:"hb"`
}

// Heartbeat is sent by the agent every `hb` seconds and echoed by the server (§6).
type Heartbeat struct {
	T string `json:"t"`
}

// Command is the union of the fields of every server command (§4). Optional fields are pointers so
// that "absent" can be told apart from a zero value.
type Command struct {
	T       string `json:"t"`
	ID      string `json:"id"`
	MAC     string `json:"mac,omitempty"`
	IP      string `json:"ip,omitempty"`
	Port    *int   `json:"port,omitempty"`
	Timeout *int   `json:"timeout,omitempty"`
	Out     string `json:"out,omitempty"`
	Long    *bool  `json:"long,omitempty"`
	On      *bool  `json:"on,omitempty"`
}

// Ack answers wake, press and set (§4).
type Ack struct {
	T   string `json:"t"`
	ID  string `json:"id"`
	OK  bool   `json:"ok"`
	Err string `json:"err,omitempty"`
	// On carries the resulting switch state in the ack of a set (§4.4).
	On *bool `json:"on,omitempty"`
}

// ProbeResult answers probe (§4.2).
type ProbeResult struct {
	T   string `json:"t"`
	ID  string `json:"id"`
	Up  bool   `json:"up"`
	MS  *int64 `json:"ms,omitempty"`
	Err string `json:"err,omitempty"`
}

// OutState reports a switch change not caused by set (§5.1).
type OutState struct {
	T   string `json:"t"`
	Out string `json:"out"`
	On  bool   `json:"on"`
}

// IsCommand reports whether t is a command type the agent must answer.
func IsCommand(t string) bool {
	switch t {
	case TypeWake, TypeProbe, TypePress, TypeSet:
		return true
	}
	return false
}
