export interface ChannelTypeInfo {
  type: string
  name: string
  icon: string
  description: string
}

export const CHANNEL_TYPES: ChannelTypeInfo[] = [
  { type: 'wecom', name: '企业微信', icon: 'message-square', description: '推送到企业微信群聊或单聊' },
  { type: 'feishu', name: '飞书', icon: 'send', description: '推送到飞书群聊或单聊' },
  { type: 'localfile', name: '本地文件', icon: 'file-text', description: '输出到本地 JSONL / JSON 文件' },
]

export function defaultConfigForType(type: string): Record<string, any> {
  switch (type) {
    case 'wecom': return { enabled: false, chatId: '', botId: '', secret: '' }
    case 'feishu': return { enabled: false, webhookUrl: '', secret: '' }
    case 'localfile': return { enabled: false, outputPath: '', format: 'jsonl' }
    default: return { enabled: false }
  }
}

export interface ChannelInstance {
  id: string
  type: string
  name: string
  enabled: boolean
  config: Record<string, any>
}

export interface ChannelsData {
  [id: string]: ChannelInstance
}
