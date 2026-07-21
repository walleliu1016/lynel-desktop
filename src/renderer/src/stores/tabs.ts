import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Tab, TabType } from '../types/tab'

function generateTabId(type: TabType, payload?: Record<string, unknown>): string {
  if (type === 'session' && payload?.sessionId) {
    return `session-${payload.sessionId}`
  }
  return type
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([{ id: 'welcome', type: 'welcome', title: '首页' }])
  const activeId = ref<string>('welcome')

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)
  const activeType = computed(() => activeTab.value?.type ?? 'welcome')

  function activate(id: string) {
    if (tabs.value.some((t) => t.id === id)) {
      activeId.value = id
    }
  }

  function open(tab: Omit<Tab, 'id'>) {
    const id = generateTabId(tab.type, tab.payload)
    const existing = tabs.value.find((t) => t.id === id)
    if (existing) {
      activeId.value = existing.id
      return existing.id
    }
    const newTab: Tab = { ...tab, id }
    tabs.value = [...tabs.value, newTab]
    activeId.value = id
    return id
  }

  function openWelcome() {
    return open({ type: 'welcome', title: '首页' })
  }

  function openSession(sessionId: string, workdir: string, title?: string) {
    return open({
      type: 'session',
      title: title ?? sessionId.slice(0, 8),
      payload: { sessionId, workdir },
    })
  }

  function openSettings() {
    return open({ type: 'settings', title: '设置' })
  }

  function openGuide() {
    return open({ type: 'guide', title: '使用指南' })
  }

  function close(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    const wasActive = activeId.value === id
    tabs.value = tabs.value.filter((t) => t.id !== id)

    if (tabs.value.length === 0) {
      openWelcome()
      return
    }

    if (wasActive) {
      const next = tabs.value[idx] || tabs.value[idx - 1] || tabs.value[0]
      activeId.value = next.id
    }
  }

  function updateTitle(id: string, title: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) {
      tab.title = title
    }
  }

  return {
    tabs,
    activeId,
    activeTab,
    activeType,
    activate,
    open,
    openWelcome,
    openSession,
    openSettings,
    openGuide,
    close,
    updateTitle,
  }
})
