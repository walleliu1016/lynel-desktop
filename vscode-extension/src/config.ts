// config: 扩展配置读取
// TODO: 实现从 VS Code settings 读取配置，当前返回默认值

export interface LynelConfig {
  claudeBin: string;
}

let cachedConfig: LynelConfig | null = null;

export function getConfig(): LynelConfig {
  if (cachedConfig) return cachedConfig;
  // 默认使用 'claude'，依赖系统 PATH
  cachedConfig = { claudeBin: 'claude' };
  return cachedConfig;
}

export function refreshConfig(): void {
  cachedConfig = null;
}
