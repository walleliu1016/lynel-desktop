// Package providers persists Claude API provider configs in ~/.ease-app/providers.json.
package providers

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// envKeyToField maps Claude settings.json env keys back to Provider fields.
var envKeyToField = map[string]func(*Provider, string){
	EnvBaseURL:           func(p *Provider, v string) { p.BaseURL = v },
	EnvAuthToken:         func(p *Provider, v string) { p.AuthToken = v },
	EnvDefaultModel:      func(p *Provider, v string) { p.DefaultModel = v },
	EnvDefaultHaikuModel: func(p *Provider, v string) { p.DefaultHaikuModel = v },
	EnvDefaultSonnetModel: func(p *Provider, v string) { p.DefaultSonnetModel = v },
	EnvDefaultOpusModel:  func(p *Provider, v string) { p.DefaultOpusModel = v },
	EnvReasoningModel:    func(p *Provider, v string) { p.ReasoningModel = v },
}

// Provider holds one cloud provider's configuration.
type Provider struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	BaseURL           string `json:"base_url"`
	AuthToken         string `json:"auth_token"`
	DefaultModel      string `json:"default_model"`
	DefaultHaikuModel string `json:"default_haiku_model"`
	DefaultSonnetModel string `json:"default_sonnet_model"`
	DefaultOpusModel  string `json:"default_opus_model"`
	ReasoningModel    string `json:"reasoning_model"`
}

// Config is the top-level persisted structure.
type Config struct {
	ActiveProviderID string     `json:"active_provider_id"`
	Providers        []Provider `json:"providers"`
}

// Default returns a config with a single Anthropic official provider.
func Default() *Config {
	return &Config{
		ActiveProviderID: "anthropic-official",
		Providers: []Provider{
			{
				ID:      "anthropic-official",
				Name:    "Anthropic 官方",
				BaseURL: "https://api.anthropic.com",
			},
		},
	}
}

// ImportFromClaudeSettings reads ~/.claude/settings.json and creates a provider
// from the existing env variables. If no env variables are present, it returns
// nil so the caller can fall back to Default().
func ImportFromClaudeSettings() (*Config, error) {
	data, err := os.ReadFile(ClaudeSettingsPath())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}

	var raw struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if len(raw.Env) == 0 {
		return nil, nil
	}

	p := Provider{
		ID:   "imported-default",
		Name: "当前配置",
	}
	for k, set := range envKeyToField {
		if v, ok := raw.Env[k]; ok {
			set(&p, v)
		}
	}

	// If none of the recognized provider keys were found, fall back to default.
	if p.BaseURL == "" && p.AuthToken == "" && p.DefaultModel == "" &&
		p.DefaultHaikuModel == "" && p.DefaultSonnetModel == "" && p.DefaultOpusModel == "" &&
		p.ReasoningModel == "" {
		return nil, nil
	}

	return &Config{
		ActiveProviderID: p.ID,
		Providers:        []Provider{p},
	}, nil
}

var (
	pathMu sync.RWMutex
	path   = defaultPath()
)

func defaultPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ease-app", "providers.json")
}

// SetPath overrides the default config path. Used by tests.
func SetPath(p string) {
	pathMu.Lock()
	defer pathMu.Unlock()
	path = p
}

// Path returns the current config path.
func Path() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return path
}

// Load reads the provider config from disk. If the file does not exist,
// it tries to import the current env from ~/.claude/settings.json; otherwise
// it falls back to Default().
func Load() (*Config, error) {
	p := Path()
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			cfg, ierr := ImportFromClaudeSettings()
			if ierr != nil {
				return nil, ierr
			}
			if cfg != nil {
				return cfg, nil
			}
			return Default(), nil
		}
		return nil, err
	}
	cfg := Default()
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	if len(cfg.Providers) == 0 {
		cfg.Providers = Default().Providers
	}
	return cfg, nil
}

// Save writes the provider config atomically (tmp + rename).
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

// Find returns the provider with the given id, or nil if not found.
func Find(cfg *Config, id string) *Provider {
	for i := range cfg.Providers {
		if cfg.Providers[i].ID == id {
			return &cfg.Providers[i]
		}
	}
	return nil
}
