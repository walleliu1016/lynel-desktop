// src/main/tasks/paths.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getStore } from '../store.js';

/** 所有任务共用的工作目录默认值。不要改成安装目录：macOS 会破坏 .app 签名，
 *  electron-updater 升级会原地替换导致数据丢失，asar 内只读。 */
export const DEFAULT_TASKS_DIR = path.join(os.homedir(), '.lynel-desktop', 'tasks');

const TASKS_CLAUDE_MD = `# Lynel 定时任务工作目录

这是 Lynel 定时任务的固定工作目录，所有任务都在这里执行。

- 任务产物（报告、临时文件、脚本）放在这个目录里。
- 要操作其他项目，请在命令中使用**绝对路径**（例如 \`cd /g/work/myproj && npm test\`）。
  Bash 工具每次调用都是新 shell，\`cd\` 不会跨调用保持。
- 其他项目的 CLAUDE.md 不会被自动加载（它按当前工作目录发现）。
`;

export function resolveTasksDir(configured: unknown): string {
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return DEFAULT_TASKS_DIR;
}

export function tasksDir(): string {
  return resolveTasksDir(getStore('settings').get('tasks_dir'));
}

/** 建目录 + 落初始 CLAUDE.md（已存在则不覆盖）。返回最终目录路径。 */
export function ensureTasksDir(dir: string = tasksDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const md = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(md)) {
    fs.writeFileSync(md, TASKS_CLAUDE_MD, 'utf8');
  }
  return dir;
}
