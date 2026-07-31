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
  /** 主动重连定时器（断连 / SDK 重连耗尽后调度，指数退避） */
  reconnectTimer: NodeJS.Timeout | null;
}
