export type TabType = 'welcome' | 'session' | 'settings'

export interface Tab {
  id: string
  type: TabType
  title: string
  payload?: Record<string, unknown>
}

export interface SessionTabPayload {
  sessionId: string
  workdir: string
}
