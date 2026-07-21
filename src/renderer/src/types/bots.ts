export type BotSource = 'wecom' | 'feishu'

export interface BotItem {
  id: string
  name: string
  source: BotSource
  botId: string
  secret: string
  chatId: string
  createdAt: number
  updatedAt: number
  connected: boolean
}
