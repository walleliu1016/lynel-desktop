export interface Provider {
  id: string
  agent?: string        // 缺省 'claude'
  name: string
  base_url: string
  auth_token: string
  default_model: string
  default_haiku_model: string
  default_sonnet_model: string
  default_opus_model: string
  reasoning_model: string
}

export interface ProvidersConfig {
  active_provider_id: string
  providers: Provider[]
}
