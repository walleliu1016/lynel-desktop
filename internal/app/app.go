// Package app is the Wails binding layer. It is the only package exposed
// to the frontend via JSON-RPC bindings.
package app

import (
	"github.com/akke/ease-ui/internal/auth"
	"github.com/akke/ease-ui/internal/hooks"
	"github.com/akke/ease-ui/internal/settings"
)

type Options struct {
	AuthPath  string
	ConfigDir string
	ClaudeDir string
}

type App struct {
	opts     Options
	auth     *auth.Auth
	settings *settings.Config
	handler  *hooks.Handler
}

func New(opts Options) (*App, error) {
	if opts.AuthPath != "" {
		auth.SetPath(opts.AuthPath)
	}
	if opts.ConfigDir != "" {
		settings.SetPath(opts.ConfigDir + "/config.json")
		hooks.SetPath(opts.ConfigDir + "/.claude/settings.json")
	}
	a, err := auth.New()
	if err != nil {
		return nil, err
	}
	cfg, err := settings.Load()
	if err != nil {
		return nil, err
	}
	return &App{
		opts:     opts,
		auth:     a,
		settings: cfg,
		handler:  hooks.NewHandler(cfg.AutoAllowBash),
	}, nil
}
