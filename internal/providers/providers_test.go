package providers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_DefaultWhenMissing(t *testing.T) {
	tmp := t.TempDir()
	SetPath(filepath.Join(tmp, "providers.json"))
	defer SetPath(defaultPath())

	// Isolate from real ~/.claude/settings.json.
	t.Setenv("HOME", tmp)
	if _, ok := os.LookupEnv("USERPROFILE"); ok {
		t.Setenv("USERPROFILE", tmp)
	}

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "anthropic-official", cfg.ActiveProviderID)
	assert.Len(t, cfg.Providers, 1)
	assert.Equal(t, "Anthropic 官方", cfg.Providers[0].Name)
}

func TestLoadAndSave(t *testing.T) {
	tmp := t.TempDir()
	SetPath(filepath.Join(tmp, "providers.json"))
	defer SetPath(defaultPath())

	cfg := Default()
	cfg.Providers = append(cfg.Providers, Provider{
		ID:   "custom",
		Name: "Custom",
	})
	require.NoError(t, Save(cfg))

	loaded, err := Load()
	require.NoError(t, err)
	assert.Equal(t, cfg.ActiveProviderID, loaded.ActiveProviderID)
	assert.Len(t, loaded.Providers, 2)
}

func TestFind(t *testing.T) {
	cfg := Default()
	p := Find(cfg, "anthropic-official")
	require.NotNil(t, p)
	assert.Equal(t, "Anthropic 官方", p.Name)
	assert.Nil(t, Find(cfg, "missing"))
}

func TestSaveCreatesDirectory(t *testing.T) {
	tmp := t.TempDir()
	deep := filepath.Join(tmp, "deep", "path")
	SetPath(filepath.Join(deep, "providers.json"))
	defer SetPath(defaultPath())

	require.NoError(t, Save(Default()))
	_, err := os.Stat(deep)
	require.NoError(t, err)
}

func TestLoad_ImportsFromClaudeSettings(t *testing.T) {
	tmp := t.TempDir()
	SetPath(filepath.Join(tmp, "providers.json"))
	defer SetPath(defaultPath())

	t.Setenv("HOME", tmp)
	if _, ok := os.LookupEnv("USERPROFILE"); ok {
		t.Setenv("USERPROFILE", tmp)
	}

	claudeDir := filepath.Join(tmp, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o755))
	settings := map[string]any{
		"env": map[string]string{
			EnvBaseURL:        "https://api.example.com",
			EnvAuthToken:      "secret-token",
			EnvDefaultModel:   "claude-model",
			EnvReasoningModel: "claude-reasoning",
		},
	}
	data, _ := json.MarshalIndent(settings, "", "  ")
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), data, 0o644))

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "imported-default", cfg.ActiveProviderID)
	require.Len(t, cfg.Providers, 1)
	p := cfg.Providers[0]
	assert.Equal(t, "当前配置", p.Name)
	assert.Equal(t, "https://api.example.com", p.BaseURL)
	assert.Equal(t, "secret-token", p.AuthToken)
	assert.Equal(t, "claude-model", p.DefaultModel)
	assert.Equal(t, "claude-reasoning", p.ReasoningModel)
}

func TestLoad_FallsBackToDefaultWhenClaudeSettingsEmpty(t *testing.T) {
	tmp := t.TempDir()
	SetPath(filepath.Join(tmp, "providers.json"))
	defer SetPath(defaultPath())

	t.Setenv("HOME", tmp)
	if _, ok := os.LookupEnv("USERPROFILE"); ok {
		t.Setenv("USERPROFILE", tmp)
	}

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "anthropic-official", cfg.ActiveProviderID)
}
