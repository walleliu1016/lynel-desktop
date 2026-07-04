// Package settings persists user-tunable config in ~/.ease-ui/config.json.
package settings

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

type Config struct {
	Theme               string `json:"theme"`
	ClaudePath          string `json:"claude_path"`
	AutoAllowBash       bool   `json:"auto_allow_bash"`
	LogEnabled          bool   `json:"log_enabled"`
	AutoLockMinutes     int    `json:"auto_lock_minutes"`
	AutoStart           bool   `json:"auto_start"`
	MinimizeOnStart     bool   `json:"minimize_on_start"`
	CloudServiceEnabled bool   `json:"cloud_service_enabled"`
	CloudServiceURL     string `json:"cloud_service_url"`
	CloudServiceToken   string `json:"cloud_service_token"`
}

func Default() *Config {
	return &Config{
		Theme:           "oled-dark",
		AutoAllowBash:   false,
		LogEnabled:      false,
		AutoLockMinutes: 5,
	}
}

var (
	pathMu sync.RWMutex
	path   = defaultPath()
)

func defaultPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ease-app", "settings.json")
}

func SetPath(p string) {
	pathMu.Lock()
	defer pathMu.Unlock()
	path = p
}

func Path() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return path
}

func Load() (*Config, error) {
	p := Path()
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Default(), nil
		}
		return nil, err
	}
	cfg := Default()
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func Save(cfg *Config) error {
	p := Path()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}
