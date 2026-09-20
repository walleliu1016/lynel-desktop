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

/** 展开开头的 `~` / `~/`（Windows 上 `~\` 同样展开）。`~user/...` 不认，原样返回后由调用方按相对路径拒掉。 */
function expandHome(raw: string): string {
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

/**
 * 归一化设置里的 `tasks_dir`。
 *
 * 设置页的占位符写的就是 `~/.lynel-desktop/tasks/`，用户照抄过来必须先展开成家目录 ——
 * 否则 `ensureTasksDir` 会在 App 的 cwd 下建一个字面量 `~` 目录，而 runner 又拿同一个路径当 cwd。
 * 相对路径一律当没配、回退默认：它同样会在 cwd 下凭空建目录，且换个启动方式（快捷方式 /
 * 打包后的 working directory）就指向别处，每一次 spawn 都落在不确定的位置。
 */
export function resolveTasksDir(configured: unknown): string {
  if (typeof configured !== 'string') return DEFAULT_TASKS_DIR;
  const raw = configured.trim();
  if (!raw) return DEFAULT_TASKS_DIR;
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded) ? expanded : DEFAULT_TASKS_DIR;
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
