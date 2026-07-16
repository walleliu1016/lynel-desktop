import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Provider, ProvidersConfig } from '../types/providers'
import { GetProvidersConfig, SaveProvidersConfig } from '../composables/useElectron'

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

/** 仅在主进程返回异常空数据时作为最后兜底；正常流程主进程会自动从 settings.json 生成默认供应商 */
function defaultConfig(): ProvidersConfig {
  return {
    active_provider_id: 'default',
    providers: [
      {
        id: 'default',
        name: '默认',
        base_url: '',
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
    if (!cfg.value || !cfg.value.providers || cfg.value.providers.length === 0) {
      cfg.value = defaultConfig()
      dirty.value = true
    } else {
      dirty.value = false
    }
  }

  async function save() {
    if (!cfg.value) return
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  async function addProvider(): Promise<string> {
    if (!cfg.value) cfg.value = defaultConfig()
    const p = newProvider()
    cfg.value.providers.push(p)
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return p.id
  }

  async function removeProvider(id: string): Promise<string> {
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
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return cfg.value.active_provider_id
  }

  async function setActive(id: string) {
    if (!cfg.value) return
    cfg.value.active_provider_id = id
    dirty.value = false
    // save 会触发主进程 applyActiveProvider，立即写入 ~/.claude/settings.json
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
  }

  return { cfg, dirty, load, save, markDirty, addProvider, removeProvider, setActive }
})
