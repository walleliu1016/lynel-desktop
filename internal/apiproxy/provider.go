package apiproxy

// Provider describes how to intercept an agent's upstream API traffic.
type Provider struct {
	Name     string
	Label    string
	EnvVar   string // e.g. ANTHROPIC_BASE_URL
	Upstream string // e.g. https://api.anthropic.com
	Format   string // "anthropic" | "openai" | ...
}

// Providers is the registry of supported agents. Currently only Claude is
// implemented; the table is structured so other providers can be added later.
var Providers = map[string]Provider{
	"claude": {
		Name:     "claude",
		Label:    "Claude Code",
		EnvVar:   "ANTHROPIC_BASE_URL",
		Upstream: "https://api.anthropic.com",
		Format:   "anthropic",
	},
}

// ProviderByName returns a provider configuration or the Claude default if
// the name is unknown. This keeps the system usable while new providers are
// being added.
func ProviderByName(name string) Provider {
	if p, ok := Providers[name]; ok {
		return p
	}
	return Providers["claude"]
}
