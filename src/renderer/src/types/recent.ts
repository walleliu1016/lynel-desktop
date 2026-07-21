export interface RecentSession {
  sessionId: string
  workdir: string
  project: string
  aiTitle: string
  firstPrompt: string
  userTitle?: string
  lastOpenedAt: number
  state: string
  botId?: string
}
