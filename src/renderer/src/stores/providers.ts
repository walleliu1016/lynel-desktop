import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Provider, ProvidersConfig } from '../types/providers'
import { GetProvidersConfig, SaveProvidersConfig } from '../composables/useElectron'

function agentOf(p?: { agent?: string }): string { return p?.agent || 'claude' }

function newProvider(agent?: string): Provider {
  return {
    id: crypto.randomUUID(),
    agent,
    name: '新供应商',
    base_url: '',
    auth_token: '',
    default_model: '',
    default_haiku_model: '',
    default_sonnet_model: '',
    default_opus_model: '',
    reasoning_model: '',
    codex_provider: agent === 'codex' ? 'lynel' : undefined,
  }
}

function defaultConfig(): ProvidersConfig {
  const p = newProvider('claude')
  return { active_providers: { claude: p.id }, providers: [p] }
}

export const useProvidersStore = defineStore('providers', () => {
  const cfg = ref<ProvidersConfig | null>(null)
  const dirty = ref(false)

  async function load() {
    cfg.value = await GetProvidersConfig()
    if (!cfg.value || !cfg.value.providers || cfg.value.providers.length === 0) {
      cfg.value = defaultConfig()
      dirty.value = true
      return
    }
    // 前端兜底迁移（主进程通常已迁移）
    if (!cfg.value.active_providers) {
      const claudeId = cfg.value.active_provider_id
        || cfg.value.providers.find(p => agentOf(p) === 'claude')?.id
        || ''
      cfg.value.active_providers = { claude: claudeId }
    }
    dirty.value = false
  }

  async function save() {
    if (!cfg.value) return
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  function activeIdFor(agent: string): string {
    return cfg.value?.active_providers?.[agent] || ''
  }

  async function addProvider(agent?: string): Promise<string> {
    if (!cfg.value) cfg.value = defaultConfig()
    const p = newProvider(agent)
    cfg.value.providers.push(p)
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return p.id
  }

  async function removeProvider(id: string): Promise<string> {
    if (!cfg.value) return ''
    const idx = cfg.value.providers.findIndex(p => p.id === id)
    if (idx === -1) return ''
    const agent = agentOf(cfg.value.providers[idx])
    cfg.value.providers.splice(idx, 1)
    if (!cfg.value.active_providers) cfg.value.active_providers = {}
    const remaining = cfg.value.providers.filter(p => agentOf(p) === agent)
    if (remaining.length === 0) {
      // 组内最后一个被删：补一个空 provider 并设为激活（spec 行为细节）
      const p = newProvider(agent)
      cfg.value.providers.push(p)
      cfg.value.active_providers[agent] = p.id
    } else if (cfg.value.active_providers[agent] === id) {
      // 删的是激活项但组内仍有：改选组内第一个
      cfg.value.active_providers[agent] = remaining[0].id
    }
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return cfg.value.active_providers[agent] || ''
  }

  async function setActive(id: string) {
    if (!cfg.value) return
    const p = cfg.value.providers.find(x => x.id === id)
    if (!p) return
    if (!cfg.value.active_providers) cfg.value.active_providers = {}
    cfg.value.active_providers[agentOf(p)] = id
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
  }

  return { cfg, dirty, load, save, markDirty, addProvider, removeProvider, setActive, activeIdFor }
})
