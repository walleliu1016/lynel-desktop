import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Provider, ProvidersConfig } from '../types/providers'
import { GetProvidersConfig, SaveProvidersConfig } from '../composables/useWails'

function newProvider(): Provider {
  return {
    id: crypto.randomUUID(),
    name: '新供应商',
    base_url: '',
    auth_token: '',
    default_model: '',
    default_haiku_model: '',
    default_sonnet_model: '',
    default_opus_model: '',
    reasoning_model: '',
  }
}

function defaultConfig(): ProvidersConfig {
  return {
    active_provider_id: 'anthropic-official',
    providers: [
      {
        id: 'anthropic-official',
        name: 'Anthropic 官方',
        base_url: 'https://api.anthropic.com',
        auth_token: '',
        default_model: '',
        default_haiku_model: '',
        default_sonnet_model: '',
        default_opus_model: '',
        reasoning_model: '',
      },
    ],
  }
}

export const useProvidersStore = defineStore('providers', () => {
  const cfg = ref<ProvidersConfig | null>(null)
  const dirty = ref(false)

  async function load() {
    cfg.value = await GetProvidersConfig()
    if (!cfg.value || cfg.value.providers.length === 0) {
      cfg.value = defaultConfig()
      dirty.value = true
    } else {
      dirty.value = false
    }
  }

  async function save() {
    if (!cfg.value) return
    await SaveProvidersConfig(cfg.value)
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  function addProvider(): string {
    if (!cfg.value) cfg.value = defaultConfig()
    const p = newProvider()
    cfg.value.providers.push(p)
    dirty.value = true
    return p.id
  }

  function removeProvider(id: string): string {
    if (!cfg.value) return ''
    const idx = cfg.value.providers.findIndex(p => p.id === id)
    if (idx === -1) return cfg.value.active_provider_id
    cfg.value.providers.splice(idx, 1)
    if (cfg.value.providers.length === 0) {
      const p = newProvider()
      cfg.value.providers.push(p)
      cfg.value.active_provider_id = p.id
    } else if (cfg.value.active_provider_id === id) {
      cfg.value.active_provider_id = cfg.value.providers[0].id
    }
    dirty.value = true
    return cfg.value.active_provider_id
  }

  function setActive(id: string) {
    if (!cfg.value) return
    cfg.value.active_provider_id = id
    dirty.value = true
  }

  return { cfg, dirty, load, save, markDirty, addProvider, removeProvider, setActive }
})
