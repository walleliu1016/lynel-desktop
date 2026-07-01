package providers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToEnv_FallsBackToDefaultModel(t *testing.T) {
	p := Provider{
		BaseURL:      "https://api.example.com",
		AuthToken:    "secret",
		DefaultModel: "claude-sonnet-4-6",
		ReasoningModel: "claude-opus-4-7",
	}
	env := ToEnv(p)
	assert.Equal(t, "https://api.example.com", env[EnvBaseURL])
	assert.Equal(t, "secret", env[EnvAuthToken])
	assert.Equal(t, "claude-sonnet-4-6", env[EnvDefaultModel])
	assert.Equal(t, "claude-sonnet-4-6", env[EnvDefaultHaikuModel])
	assert.Equal(t, "claude-sonnet-4-6", env[EnvDefaultSonnetModel])
	assert.Equal(t, "claude-sonnet-4-6", env[EnvDefaultOpusModel])
	assert.Equal(t, "claude-opus-4-7", env[EnvReasoningModel])
}

func TestToEnv_OverridesWhenSet(t *testing.T) {
	p := Provider{
		DefaultModel:       "default",
		DefaultHaikuModel:  "haiku",
		DefaultSonnetModel: "sonnet",
		DefaultOpusModel:   "opus",
	}
	env := ToEnv(p)
	assert.Equal(t, "haiku", env[EnvDefaultHaikuModel])
	assert.Equal(t, "sonnet", env[EnvDefaultSonnetModel])
	assert.Equal(t, "opus", env[EnvDefaultOpusModel])
}

func TestApplyToClaudeSettings(t *testing.T) {
	tmp := t.TempDir()
	defer SetPath(defaultPath())

	// Override claude settings path via environment home directory.
	t.Setenv("HOME", tmp)
	if _, ok := os.LookupEnv("USERPROFILE"); ok {
		t.Setenv("USERPROFILE", tmp)
	}

	p := Provider{
		BaseURL:   "https://api.example.com",
		AuthToken: "token",
		DefaultModel: "claude-model",
	}
	require.NoError(t, ApplyToClaudeSettings(p))

	data, err := os.ReadFile(filepath.Join(tmp, ".claude", "settings.json"))
	require.NoError(t, err)

	var result map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(data, &result))

	var env map[string]string
	require.NoError(t, json.Unmarshal(result["env"], &env))
	assert.Equal(t, "https://api.example.com", env[EnvBaseURL])
	assert.Equal(t, "token", env[EnvAuthToken])
	assert.Equal(t, "claude-model", env[EnvDefaultModel])
	assert.Equal(t, "claude-model", env[EnvDefaultHaikuModel])
}

func TestApplyToClaudeSettings_PreservesUnknownFields(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	if _, ok := os.LookupEnv("USERPROFILE"); ok {
		t.Setenv("USERPROFILE", tmp)
	}

	claudeDir := filepath.Join(tmp, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o755))
	initial := map[string]any{
		"foo": "bar",
		"env": map[string]string{
			"OTHER_KEY": "other-value",
		},
	}
	data, _ := json.MarshalIndent(initial, "", "  ")
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), data, 0o644))

	p := Provider{BaseURL: "https://x.com"}
	require.NoError(t, ApplyToClaudeSettings(p))

	out, err := os.ReadFile(filepath.Join(claudeDir, "settings.json"))
	require.NoError(t, err)
	var result map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(out, &result))
	assert.Equal(t, "\"bar\"", string(result["foo"]))

	var env map[string]string
	require.NoError(t, json.Unmarshal(result["env"], &env))
	assert.Equal(t, "other-value", env["OTHER_KEY"])
	assert.Equal(t, "https://x.com", env[EnvBaseURL])
}
