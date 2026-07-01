package providers

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
)

// Claude settings.json env key names.
const (
	EnvBaseURL           = "ANTHROPIC_BASE_URL"
	EnvAuthToken         = "ANTHROPIC_AUTH_TOKEN"
	EnvDefaultModel      = "ANTHROPIC_MODEL"
	EnvDefaultHaikuModel = "ANTHROPIC_DEFAULT_HAIKU_MODEL"
	EnvDefaultSonnetModel = "ANTHROPIC_DEFAULT_SONNET_MODEL"
	EnvDefaultOpusModel  = "ANTHROPIC_DEFAULT_OPUS_MODEL"
	EnvReasoningModel    = "ANTHROPIC_REASONING_MODEL"
)

// ToEnv converts a Provider into the env map written to Claude settings.json.
// Empty model fields fall back to the provider's default_model.
func ToEnv(p Provider) map[string]string {
	haiku := p.DefaultHaikuModel
	if haiku == "" {
		haiku = p.DefaultModel
	}
	sonnet := p.DefaultSonnetModel
	if sonnet == "" {
		sonnet = p.DefaultModel
	}
	opus := p.DefaultOpusModel
	if opus == "" {
		opus = p.DefaultModel
	}

	env := make(map[string]string)
	setIfNonEmpty(env, EnvBaseURL, p.BaseURL)
	setIfNonEmpty(env, EnvAuthToken, p.AuthToken)
	setIfNonEmpty(env, EnvDefaultModel, p.DefaultModel)
	setIfNonEmpty(env, EnvDefaultHaikuModel, haiku)
	setIfNonEmpty(env, EnvDefaultSonnetModel, sonnet)
	setIfNonEmpty(env, EnvDefaultOpusModel, opus)
	setIfNonEmpty(env, EnvReasoningModel, p.ReasoningModel)
	return env
}

func setIfNonEmpty(m map[string]string, k, v string) {
	if v != "" {
		m[k] = v
	}
}

// ClaudeSettingsPath returns ~/.claude/settings.json.
func ClaudeSettingsPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "settings.json")
}

// ApplyToClaudeSettings writes the active provider's env into
// ~/.claude/settings.json, preserving all other top-level fields.
func ApplyToClaudeSettings(p Provider) error {
	return writeEnvToClaudeSettings(ToEnv(p))
}

// ApplyDefaults fills fallback values without mutating the original provider.
func ApplyDefaults(p Provider) *Provider {
	if p.DefaultHaikuModel == "" {
		p.DefaultHaikuModel = p.DefaultModel
	}
	if p.DefaultSonnetModel == "" {
		p.DefaultSonnetModel = p.DefaultModel
	}
	if p.DefaultOpusModel == "" {
		p.DefaultOpusModel = p.DefaultModel
	}
	return &p
}

func writeEnvToClaudeSettings(env map[string]string) error {
	path := ClaudeSettingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	existing := map[string]json.RawMessage{}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &existing)
	}

	newEnv := map[string]string{}
	if raw, ok := existing["env"]; ok {
		_ = json.Unmarshal(raw, &newEnv)
	}
	maps.Copy(newEnv, env)

	if len(newEnv) == 0 {
		delete(existing, "env")
	} else {
		out, _ := json.Marshal(newEnv)
		existing["env"] = out
	}

	out, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
