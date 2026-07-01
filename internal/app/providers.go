package app

import "github.com/akke/ease-ui/internal/providers"

// GetProvidersConfig loads the provider configuration from ~/.ease-app/providers.json.
func (a *App) GetProvidersConfig() (*providers.Config, error) {
	return providers.Load()
}

// SaveProvidersConfig persists the provider configuration and applies the active
// provider's env to ~/.claude/settings.json.
func (a *App) SaveProvidersConfig(cfg *providers.Config) error {
	if err := providers.Save(cfg); err != nil {
		return err
	}
	return a.ApplyActiveProvider()
}

// ApplyActiveProvider writes the currently selected provider's env into
// ~/.claude/settings.json. If no active provider exists, this is a no-op.
func (a *App) ApplyActiveProvider() error {
	cfg, err := providers.Load()
	if err != nil {
		return err
	}
	p := providers.Find(cfg, cfg.ActiveProviderID)
	if p == nil {
		return nil
	}
	return providers.ApplyToClaudeSettings(*p)
}
