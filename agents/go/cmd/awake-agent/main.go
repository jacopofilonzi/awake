// Command awake-agent is the reference Awake agent: it keeps an outbound WebSocket connection to the
// Awake server and sends Wake-on-LAN packets, probes hosts and drives its outputs on request
// (see docs/PROTOCOL.md).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/jacopofilonzi/awake/agents/go/internal/client"
	"github.com/jacopofilonzi/awake/agents/go/internal/config"
	"github.com/jacopofilonzi/awake/agents/go/internal/console"
	"github.com/jacopofilonzi/awake/agents/go/internal/outputs"
	"github.com/jacopofilonzi/awake/agents/go/internal/probe"
	"github.com/jacopofilonzi/awake/agents/go/internal/wol"
)

// version is overridden at build time with -ldflags "-X main.version=x.y.z".
var version = "0.1.0-dev"

const defaultConfigPath = "awake-agent.toml"

func main() {
	os.Exit(run())
}

func run() int {
	flags := flag.NewFlagSet("awake-agent", flag.ContinueOnError)
	configPath := flags.String("config", defaultConfigPath, "path of the TOML config file")
	dryRun := flags.Bool("dry-run", false, "log magic packets instead of sending them (overrides config and AWAKE_DRY_RUN)")
	useConsole := flags.Bool("console", stdinIsTerminal(), "read simulated local commands from stdin (default: on when stdin is a terminal)")
	logLevel := flags.String("log-level", "info", "log level: debug, info, warn or error")
	showVersion := flags.Bool("version", false, "print the version and exit")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	explicit := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { explicit[f.Name] = true })

	if *showVersion {
		fmt.Println(firmware())
		return 0
	}

	var level slog.Level
	if err := level.UnmarshalText([]byte(*logLevel)); err != nil {
		fmt.Fprintf(os.Stderr, "awake-agent: invalid -log-level %q: use debug, info, warn or error\n", *logLevel)
		return 2
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(log)

	cfg, err := loadConfig(*configPath, explicit["config"], log)
	if err != nil {
		fmt.Fprintf(os.Stderr, "awake-agent: %v\n", err)
		return 1
	}
	if explicit["dry-run"] {
		cfg.DryRun = *dryRun
	}
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "awake-agent: invalid configuration:\n  - %s\n", strings.ReplaceAll(err.Error(), "\n", "\n  - "))
		return 1
	}

	log.Info("starting awake-agent", "version", version, "config", cfg)
	if cfg.InsecureTransport() {
		log.Warn("the server URL uses plain ws:// to a host that does not look local: the token can be sniffed; use wss://", "server", cfg.Server)
	}
	if cfg.DryRun {
		log.Warn("dry run: magic packets are logged, not sent")
	}

	mgr, err := outputs.New(cfg.OutputConfigs(), outputs.DefaultDrivers(log), log)
	if err != nil {
		fmt.Fprintf(os.Stderr, "awake-agent: outputs: %v\n", err)
		return 1
	}
	defer func() {
		// Releases any button still pressed (the sim driver logs it).
		if err := mgr.Close(); err != nil {
			log.Error("closing outputs", "err", err)
		}
	}()

	cl := client.New(client.Options{
		URL:      cfg.Server,
		Token:    cfg.Token,
		Firmware: firmware(),
		Outputs:  mgr,
		Waker: &wol.Sender{
			Port:   cfg.WoL.Port,
			Extra:  cfg.BroadcastAddrs(),
			Auto:   cfg.AutoBroadcast(),
			DryRun: cfg.DryRun,
			Log:    log,
		},
		Prober: probe.New(log),
		Log:    log,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		// After the first signal, restore the default handling so a second Ctrl+C kills the agent
		// even if the close handshake hangs.
		<-ctx.Done()
		stop()
	}()

	if *useConsole {
		con := &console.Console{In: os.Stdin, Out: os.Stdout, Outputs: mgr, Status: cl.Status, Server: cfg.Server, Log: log}
		go con.Run(ctx)
	}

	if err := cl.Run(ctx); err != nil {
		log.Error("agent stopped", "err", err)
		return 1
	}
	log.Info("agent stopped")
	return 0
}

// loadConfig reads the file, falling back to defaults when the default file is absent (so the agent
// can run from environment variables alone), then applies the environment.
func loadConfig(path string, explicit bool, log *slog.Logger) (*config.Config, error) {
	cfg, err := config.Load(path)
	switch {
	case err == nil:
	case !explicit && errors.Is(err, fs.ErrNotExist):
		log.Info("no config file found; using defaults and environment", "path", path)
		cfg = config.Default()
	default:
		return nil, err
	}
	if err := cfg.FromEnv(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func firmware() string { return "awake-agent-go/" + version }

// stdinIsTerminal reports whether stdin is an interactive console (a character device), which is how
// the console decides to turn itself on by default. Works the same on Windows and Unix.
func stdinIsTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
