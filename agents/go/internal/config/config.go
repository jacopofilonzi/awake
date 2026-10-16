// Package config loads the agent configuration: a TOML file, then environment overrides
// (AWAKE_SERVER, AWAKE_TOKEN, AWAKE_DRY_RUN), then validation of the whole result.
//
// Validation is strict and happens once at startup, so that a typo in an output id or a duration fails
// loudly instead of producing an agent the server rejects (hello with invalid outputs closes with 4000)
// or a relay pressed for the wrong time.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"

	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/protocol"
)

// Defaults.
const (
	DefaultServer  = "ws://localhost:8080/agent"
	DefaultWoLPort = 9
	DefaultDriver  = "sim"
	DefaultShortMS = 300
	// MaxPressMS bounds press durations: a relay held for minutes is almost certainly a config typo.
	MaxPressMS = 60_000
)

// Env var names.
const (
	EnvServer = "AWAKE_SERVER"
	EnvToken  = "AWAKE_TOKEN"
	EnvDryRun = "AWAKE_DRY_RUN"
)

// Config is the agent configuration as written in the TOML file.
type Config struct {
	Server  string   `toml:"server"`
	Token   string   `toml:"token"`
	DryRun  bool     `toml:"dry_run"`
	WoL     WoL      `toml:"wol"`
	Outputs []Output `toml:"outputs"`
}

// WoL configures magic packets.
type WoL struct {
	Port int `toml:"port"`
	// Broadcast lists extra destination addresses, on top of 255.255.255.255 and (with AutoBroadcast)
	// the directed broadcasts of the local subnets.
	Broadcast []string `toml:"broadcast"`
	// AutoBroadcast defaults to true; nil means "not set".
	AutoBroadcast *bool `toml:"auto_broadcast"`
}

// Output is one `[[outputs]]` table. Pointers tell "absent" from zero, which validation needs (a switch
// must not have press durations, a button must not have `initial`).
type Output struct {
	ID      string `toml:"id"`
	Mode    string `toml:"mode"`
	Driver  string `toml:"driver"`
	ShortMS *int   `toml:"short_ms"`
	LongMS  *int   `toml:"long_ms"`
	Initial *bool  `toml:"initial"`
}

// Default returns the configuration used when no file is given.
func Default() *Config {
	return &Config{Server: DefaultServer, WoL: WoL{Port: DefaultWoLPort}}
}

// Load reads a TOML file on top of the defaults. Unknown keys are an error: a misspelled key (e.g.
// `long-ms`) would otherwise be silently ignored.
func Load(path string) (*Config, error) {
	cfg := Default()
	md, err := toml.DecodeFile(path, cfg)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	if undecoded := md.Undecoded(); len(undecoded) > 0 {
		keys := make([]string, len(undecoded))
		for i, k := range undecoded {
			keys[i] = k.String()
		}
		return nil, fmt.Errorf("config %s: unknown keys: %s", path, strings.Join(keys, ", "))
	}
	return cfg, nil
}

// ApplyEnv applies the AWAKE_* overrides. lookup is os.LookupEnv in production.
func (c *Config) ApplyEnv(lookup func(string) (string, bool)) error {
	if v, ok := lookup(EnvServer); ok && v != "" {
		c.Server = v
	}
	if v, ok := lookup(EnvToken); ok && v != "" {
		c.Token = v
	}
	if v, ok := lookup(EnvDryRun); ok && v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("%s=%q: not a boolean", EnvDryRun, v)
		}
		c.DryRun = b
	}
	return nil
}

// FromEnv is ApplyEnv with the process environment.
func (c *Config) FromEnv() error { return c.ApplyEnv(os.LookupEnv) }

// Validate checks the whole configuration and reports every problem at once.
func (c *Config) Validate() error {
	var errs []error
	if err := validateServer(c.Server); err != nil {
		errs = append(errs, err)
	}
	if strings.TrimSpace(c.Token) == "" {
		errs = append(errs, fmt.Errorf("token is empty: set %s or `token` in the config file", EnvToken))
	}
	if c.WoL.Port < 1 || c.WoL.Port > 65535 {
		errs = append(errs, fmt.Errorf("wol.port %d out of range 1-65535", c.WoL.Port))
	}
	for _, b := range c.WoL.Broadcast {
		if _, err := protocol.ParseIPv4(b); err != nil {
			errs = append(errs, fmt.Errorf("wol.broadcast: %w", err))
		}
	}
	if len(c.Outputs) > protocol.MaxOutputs {
		errs = append(errs, fmt.Errorf("%d outputs configured, at most %d allowed", len(c.Outputs), protocol.MaxOutputs))
	}
	seen := map[string]bool{}
	for i, o := range c.Outputs {
		name := fmt.Sprintf("outputs[%d] (%q)", i, o.ID)
		if err := protocol.ValidateOutputID(o.ID); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
		}
		if seen[o.ID] {
			errs = append(errs, fmt.Errorf("%s: duplicate id", name))
		}
		seen[o.ID] = true
		errs = append(errs, validateOutput(name, o)...)
	}
	return errors.Join(errs...)
}

func validateServer(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("server %q: %w", raw, err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return fmt.Errorf("server %q: scheme must be ws:// or wss://", raw)
	}
	if u.Host == "" {
		return fmt.Errorf("server %q: missing host", raw)
	}
	if u.User != nil {
		return fmt.Errorf("server %q: credentials in the URL are not supported; use the token", u.Redacted())
	}
	return nil
}

func validateOutput(name string, o Output) []error {
	var errs []error
	switch o.Mode {
	case protocol.ModeButton:
		if o.Initial != nil {
			errs = append(errs, fmt.Errorf("%s: `initial` is only for switches", name))
		}
		short := DefaultShortMS
		if o.ShortMS != nil {
			short = *o.ShortMS
		}
		if short <= 0 || short > MaxPressMS {
			errs = append(errs, fmt.Errorf("%s: short_ms %d must be in 1-%d", name, short, MaxPressMS))
		}
		if o.LongMS != nil && (*o.LongMS <= short || *o.LongMS > MaxPressMS) {
			errs = append(errs, fmt.Errorf("%s: long_ms %d must be greater than short_ms (%d) and at most %d", name, *o.LongMS, short, MaxPressMS))
		}
	case protocol.ModeSwitch:
		if o.ShortMS != nil || o.LongMS != nil {
			errs = append(errs, fmt.Errorf("%s: short_ms/long_ms are only for buttons", name))
		}
	default:
		errs = append(errs, fmt.Errorf("%s: mode %q must be %q or %q", name, o.Mode, protocol.ModeButton, protocol.ModeSwitch))
	}
	return errs
}

// OutputConfigs converts the validated outputs for the outputs package, applying defaults.
func (c *Config) OutputConfigs() []outputs.Config {
	out := make([]outputs.Config, 0, len(c.Outputs))
	for _, o := range c.Outputs {
		oc := outputs.Config{ID: o.ID, Mode: o.Mode, Driver: o.Driver}
		if oc.Driver == "" {
			oc.Driver = DefaultDriver
		}
		if o.Mode == protocol.ModeButton {
			short := DefaultShortMS
			if o.ShortMS != nil {
				short = *o.ShortMS
			}
			oc.Short = time.Duration(short) * time.Millisecond
			if o.LongMS != nil {
				oc.Long = time.Duration(*o.LongMS) * time.Millisecond
			}
		}
		if o.Initial != nil {
			oc.Initial = *o.Initial
		}
		out = append(out, oc)
	}
	return out
}

// BroadcastAddrs returns the parsed wol.broadcast addresses (call after Validate).
func (c *Config) BroadcastAddrs() []netip.Addr {
	var out []netip.Addr
	for _, b := range c.WoL.Broadcast {
		if a, err := protocol.ParseIPv4(b); err == nil {
			out = append(out, a)
		}
	}
	return out
}

// AutoBroadcast reports whether local directed broadcasts are added (default true).
func (c *Config) AutoBroadcast() bool {
	return c.WoL.AutoBroadcast == nil || *c.WoL.AutoBroadcast
}

// InsecureTransport reports whether the server URL sends the token in clear text to a host that does
// not look local (§10: plain ws:// only inside a trusted LAN or VPN). Hostnames can't be classified
// reliably, so only single-label names and the usual local suffixes count as local.
func (c *Config) InsecureTransport() bool {
	u, err := url.Parse(c.Server)
	if err != nil || u.Scheme != "ws" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || !strings.Contains(host, ".") {
		return false
	}
	for _, suffix := range []string{".local", ".lan", ".home.arpa", ".internal", ".localhost"} {
		if strings.HasSuffix(host, suffix) {
			return false
		}
	}
	if ip := net.ParseIP(host); ip != nil {
		return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || isCGNAT(ip))
	}
	return true
}

// isCGNAT matches 100.64.0.0/10, used by VPN overlays such as Tailscale.
func isCGNAT(ip net.IP) bool {
	v4 := ip.To4()
	return v4 != nil && v4[0] == 100 && v4[1]&0xC0 == 64
}

// LogValue implements slog.LogValuer so the config can be logged without leaking the token.
func (c *Config) LogValue() slog.Value {
	token := "(empty)"
	if c.Token != "" {
		token = "(set)"
	}
	ids := make([]string, len(c.Outputs))
	for i, o := range c.Outputs {
		ids[i] = o.ID + ":" + o.Mode
	}
	return slog.GroupValue(
		slog.String("server", c.Server),
		slog.String("token", token),
		slog.Bool("dry_run", c.DryRun),
		slog.Int("wol_port", c.WoL.Port),
		slog.Any("wol_broadcast", c.WoL.Broadcast),
		slog.Bool("wol_auto_broadcast", c.AutoBroadcast()),
		slog.Any("outputs", ids),
	)
}
