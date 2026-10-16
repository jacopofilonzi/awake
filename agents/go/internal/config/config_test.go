package config

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const goodTOML = `
server = "ws://localhost:8080/agent"
token = "awk_secret"

[wol]
port = 7
broadcast = ["192.168.1.255"]

[[outputs]]
id = "pc-power"
mode = "button"
driver = "sim"
short_ms = 300
long_ms = 5000

[[outputs]]
id = "nas"
mode = "button"

[[outputs]]
id = "lamp"
mode = "switch"
initial = true
`

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent.toml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadGood(t *testing.T) {
	cfg, err := Load(writeTemp(t, goodTOML))
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	ocs := cfg.OutputConfigs()
	if len(ocs) != 3 {
		t.Fatalf("outputs = %+v", ocs)
	}
	if ocs[0].Short != 300*time.Millisecond || ocs[0].Long != 5*time.Second {
		t.Errorf("pc-power durations = %v/%v", ocs[0].Short, ocs[0].Long)
	}
	if ocs[1].Driver != "sim" || ocs[1].Short != 300*time.Millisecond || ocs[1].Long != 0 {
		t.Errorf("nas defaults = %+v", ocs[1])
	}
	if !ocs[2].Initial {
		t.Errorf("lamp initial = false")
	}
	if !cfg.AutoBroadcast() || cfg.WoL.Port != 7 || len(cfg.BroadcastAddrs()) != 1 {
		t.Errorf("wol = %+v", cfg.WoL)
	}
}

func TestLoadUnknownKey(t *testing.T) {
	_, err := Load(writeTemp(t, goodTOML+"\nlong-ms = 3\n"))
	if err == nil || !strings.Contains(err.Error(), "unknown keys") {
		t.Fatalf("err = %v, want unknown keys", err)
	}
}

func TestValidateBad(t *testing.T) {
	ms := func(v int) *int { return &v }
	yes := true
	base := func() *Config {
		c := Default()
		c.Token = "awk_x"
		return c
	}
	cases := map[string]func(c *Config){
		"http scheme":      func(c *Config) { c.Server = "http://localhost:8080/agent" },
		"no host":          func(c *Config) { c.Server = "ws:///agent" },
		"empty token":      func(c *Config) { c.Token = "" },
		"wol port":         func(c *Config) { c.WoL.Port = 0 },
		"bad broadcast":    func(c *Config) { c.WoL.Broadcast = []string{"192.168.1"} },
		"bad id":           func(c *Config) { c.Outputs = []Output{{ID: "PC", Mode: "switch"}} },
		"duplicate id":     func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "switch"}, {ID: "a", Mode: "switch"}} },
		"bad mode":         func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "toggle"}} },
		"short zero":       func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "button", ShortMS: ms(0)}} },
		"long not > short": func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "button", ShortMS: ms(500), LongMS: ms(500)}} },
		"long too long":    func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "button", LongMS: ms(MaxPressMS + 1)}} },
		"switch durations": func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "switch", ShortMS: ms(100)}} },
		"button initial":   func(c *Config) { c.Outputs = []Output{{ID: "a", Mode: "button", Initial: &yes}} },
		"too many outputs": func(c *Config) {
			for i := range 33 {
				c.Outputs = append(c.Outputs, Output{ID: "o" + string(rune('a'+i%26)) + string(rune('a'+i/26)), Mode: "switch"})
			}
		},
	}
	if err := base().Validate(); err != nil {
		t.Fatalf("base config invalid: %v", err)
	}
	for name, mutate := range cases {
		c := base()
		mutate(c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestApplyEnv(t *testing.T) {
	c := Default()
	env := map[string]string{EnvServer: "wss://awake.example.com/agent", EnvToken: "awk_env", EnvDryRun: "true"}
	lookup := func(k string) (string, bool) { v, ok := env[k]; return v, ok }
	if err := c.ApplyEnv(lookup); err != nil {
		t.Fatal(err)
	}
	if c.Server != env[EnvServer] || c.Token != "awk_env" || !c.DryRun {
		t.Fatalf("after env: %+v", c)
	}
	env[EnvDryRun] = "maybe"
	if err := c.ApplyEnv(lookup); err == nil {
		t.Fatal("bad AWAKE_DRY_RUN accepted")
	}
}

func TestInsecureTransport(t *testing.T) {
	cases := map[string]bool{
		"ws://localhost:8080/agent":     false,
		"ws://127.0.0.1:8080/agent":     false,
		"ws://192.168.1.10:8080/agent":  false,
		"ws://nas:8080/agent":           false,
		"ws://nas.lan:8080/agent":       false,
		"ws://100.100.1.2:8080/agent":   false,
		"wss://awake.example.com/agent": false,
		"ws://awake.example.com/agent":  true,
		"ws://203.0.113.5:8080/agent":   true,
	}
	for server, want := range cases {
		c := &Config{Server: server}
		if got := c.InsecureTransport(); got != want {
			t.Errorf("InsecureTransport(%s) = %v, want %v", server, got, want)
		}
	}
}

func TestLogValueRedactsToken(t *testing.T) {
	c := Default()
	c.Token = "awk_supersecret"
	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, nil)).Info("config", "config", c)
	if strings.Contains(buf.String(), "supersecret") {
		t.Fatalf("token leaked: %s", buf.String())
	}
}
