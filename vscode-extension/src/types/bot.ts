export type BotSource = 'wecom' | 'feishu';

export interface BotConfig {
  id: string;
  name: string;
  source: BotSource;
  botId: string;
  secret: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
}

export interface BotConnectionState {
  config: BotConfig;
  wsClient: any | null;
  connecting: Promise<void> | null;
  isConnected: boolean;
}
