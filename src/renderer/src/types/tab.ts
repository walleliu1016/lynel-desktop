export type TabType = 'welcome' | 'session' | 'settings' | 'guide'

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

// TraceTabPayload 已移除，Trace 功能移至 TraceSidebar/TraceOverlay
