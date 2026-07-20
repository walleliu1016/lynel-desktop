export type TabType = 'welcome' | 'session' | 'settings' | 'guide' | 'trace'

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

export interface TraceTabPayload {
  sessionId: string
  workdir: string
}
