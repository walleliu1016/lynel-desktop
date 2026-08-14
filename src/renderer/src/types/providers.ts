export interface Provider {
  id: string
  agent?: string        // 缺省 'claude'
  name: string
  base_url: string
  auth_token: string
  default_model: string
  default_haiku_model?: string
  default_sonnet_model?: string
  default_opus_model?: string
  reasoning_model?: string
  codex_provider?: string   // codex 专属：config.toml 里 model_providers 的 key，默认 'lynel'
}

export interface ProvidersConfig {
  active_providers?: Record<string, string>   // per-agent 激活
  active_provider_id?: string                  // 旧字段，主进程已迁移
  providers: Provider[]
}
