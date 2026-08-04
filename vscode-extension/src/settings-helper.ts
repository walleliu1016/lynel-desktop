import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface SettingsOverride {
  args: string[];
  cleanup: () => void;
}

export function createSettingsOverrideFile(hookPort: number, proxyUrl: string): SettingsOverride {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const tmpDir = path.join(os.tmpdir(), 'lynel-desktop');

  let data: Record<string, any> = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (raw.trim()) data = JSON.parse(raw);
  } catch { /* 文件不存在或解析失败，使用空配置 */ }

  const hookUrl = `http://127.0.0.1:${hookPort}/hook`;

  // 注入 ANTHROPIC_BASE_URL（Claude CLI 从 settings.json env 读取，不走环境变量）
  data.env = { ...(data.env || {}), ANTHROPIC_BASE_URL: proxyUrl };

  // 注入 4 种 hook 类型
  const hookTypes: Record<string, number> = {
    PermissionRequest: 7200,
    PreToolUse: 5,
    PostToolUse: 5,
    PostToolUseFailure: 5,
  };
  const hooksObj: Record<string, any> = {};
  for (const [name, timeout] of Object.entries(hookTypes)) {
    hooksObj[name] = [{ hooks: [{ type: 'http', url: hookUrl, timeout, continueOnError: true }] }];
  }
  data.hooks = hooksObj;

  // 绕过所有权限检查（让 hook 处理）
  data.permissions = { defaultMode: 'bypassPermissions' };

  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `claude-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');

  console.log(`[Lynel] settings override created: ${tmpFile} proxyUrl=${proxyUrl} size=${fs.statSync(tmpFile).size}`);

  return {
    args: ['--settings', tmpFile],
    cleanup: () => {
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    },
  };
}
