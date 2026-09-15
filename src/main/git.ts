// Git 服务：所有 git 操作的唯一入口。
// 用 simple-git 包装系统 git CLI（与 VSCode 的做法一致：不重新实现 git，只做
// 命令代理 + 状态管理）。
// 注意：这里必须用「命名导入」而不是默认导入。
// simple-git 的 package.json 无 "type" 字段，且 dist/typings/ 下没有标注 ESM 的
// package.json，因此 TS（NodeNext）会把它的 .d.ts 当作 CJS 处理，把默认导入推断成
// 不可调用的 module.exports 命名空间（tsc 报 TS2349）。而运行时 Node 实际加载的是
// dist/esm/index.js（真 ESM，有可调用的 export default）。
// 命名导出 `simpleGit` 在 typings 和 ESM 运行时都已声明，且与 default 是同一个函数
// 对象（已实测 `default === simpleGit` 为 true），所以用命名导入既类型正确又不改变行为。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { simpleGit, type SimpleGit } from 'simple-git';

const execFileAsync = promisify(execFile);

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface GitFileChange {
  /** 相对 workDir 的路径，统一用正斜杠 */
  path: string;
  status: GitFileStatus;
  /** 重命名时的原路径 */
  oldPath?: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicted: GitFileChange[];
}

/** 非 git 仓库时的空状态。用工厂函数而非共享常量：常量做浅拷贝会让四个数组字段
 *  在各次调用间共享同一个引用，任何调用方 push 都会污染全局。 */
function emptyStatus(): GitStatusResult {
  return {
    isRepo: false,
    branch: null,
    tracking: null,
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
}

/** 每个 workDir 复用一个 SimpleGit 实例 */
const clients = new Map<string, SimpleGit>();

function gitFor(workDir: string): SimpleGit {
  let g = clients.get(workDir);
  if (!g) {
    g = simpleGit({ baseDir: workDir });
    clients.set(workDir, g);
  }
  return g;
}

/** git 的状态字母里，'?' 表示未跟踪；其余大写单字母直接用，无法识别的按 M 处理 */
function normalizeStatus(raw: string): GitFileStatus {
  const c = raw.trim().toUpperCase();
  if (c === '' || c === '?') return '?';
  if (c === 'M' || c === 'A' || c === 'D' || c === 'R' || c === 'C' || c === 'U') return c;
  // T（类型变更）等罕见字母归入 M，避免前端出现未知状态
  return 'M';
}

/** 把 simple-git 的 files[] 按「暂存 / 未暂存 / 未跟踪 / 冲突」分组 */
function groupChanges(
  files: { path: string; index: string; working_dir: string }[],
  renamed: { from: string; to: string }[],
): Pick<GitStatusResult, 'staged' | 'unstaged' | 'untracked' | 'conflicted'> {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const conflicted: GitFileChange[] = [];

  const oldPathOf = new Map(renamed.map((r) => [r.to, r.from]));

  for (const f of files) {
    const idx = f.index;
    const wd = f.working_dir;
    const oldPath = oldPathOf.get(f.path);

    // 冲突：任一侧为 U，或双方同名同操作（AA / DD）
    if (idx === 'U' || wd === 'U' || (idx === 'A' && wd === 'A') || (idx === 'D' && wd === 'D')) {
      conflicted.push({ path: f.path, status: 'U', oldPath });
      continue;
    }
    if (wd === '?') {
      untracked.push({ path: f.path, status: '?', oldPath });
      continue;
    }
    if (idx && idx !== ' ' && idx !== '?') {
      staged.push({ path: f.path, status: normalizeStatus(idx), oldPath });
    }
    if (wd && wd !== ' ' && wd !== '?') {
      unstaged.push({ path: f.path, status: normalizeStatus(wd), oldPath });
    }
  }
  return { staged, unstaged, untracked, conflicted };
}

export async function getStatus(
  workDir: string,
): Promise<{ ok: true; data: GitStatusResult } | { ok: false; error: string }> {
  try {
    const status = await gitFor(workDir).status();
    const groups = groupChanges(status.files, status.renamed);
    return {
      ok: true,
      data: {
        isRepo: true,
        branch: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        detached: status.detached,
        ...groups,
      },
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // 非 git 仓库时 simple-git 会抛错；这是正常的用户状态，不是错误
    if (/not a git repository/i.test(msg)) {
      return { ok: true, data: emptyStatus() };
    }
    return { ok: false, error: msg };
  }
}

export type GitOpResult = { ok: true } | { ok: false; error: string };

/** 统一的错误包装：主进程不得让 git 的异常冒泡（会导致窗口白屏） */
async function runOp(fn: () => Promise<unknown>): Promise<GitOpResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** 暂存：对未跟踪文件等价于 add；对已修改文件等价于 add */
export function stage(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return Promise.resolve({ ok: true });
  return runOp(() => gitFor(workDir).add(relPaths));
}

/** 取消暂存：reset 到 HEAD（新仓库尚无 HEAD 时退回 `rm --cached`） */
export function unstage(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return Promise.resolve({ ok: true });
  return runOp(async () => {
    const g = gitFor(workDir);
    try {
      await g.reset(['HEAD', '--', ...relPaths]);
    } catch {
      // 初始提交之前没有 HEAD，用 rm --cached 达到同样效果
      await g.raw(['rm', '--cached', '-r', '--', ...relPaths]);
    }
  });
}

/** 把相对路径安全解析到 workDir 内；越界抛错（与 files.ts 的 resolveEntry 同一约定，
 *  git 面板的删除操作同样不能让路径逃出工作目录） */
function resolveInside(workDir: string, rel: string): string {
  const base = path.resolve(workDir);
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`路径越界: ${rel}`);
  }
  return target;
}

/** 丢弃工作区改动：已跟踪文件 checkout 还原；未跟踪文件直接删除。
 *  调用方（渲染进程）必须先做二次确认 —— 这是不可逆操作。 */
export async function discard(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return { ok: true };

  const status = await getStatus(workDir);
  if (!status.ok) return { ok: false, error: status.error };

  const s = status.data;
  // 新增且已暂存的文件不在 HEAD 里，checkout 无处可还原 → 只能 unstage 后删除
  const addedStaged = new Set(s.staged.filter((f) => f.status === 'A').map((f) => f.path));
  // 其余已跟踪文件（工作区改动 / 已暂存改动 / 冲突）→ unstage 后 checkout 还原到 HEAD
  const tracked = new Set([
    ...s.unstaged.map((f) => f.path),
    ...s.staged.map((f) => f.path),
    ...s.conflicted.map((f) => f.path),
  ]);

  const toRestore: string[] = [];
  const toDelete: string[] = [];
  for (const rel of relPaths) {
    if (addedStaged.has(rel)) toDelete.push(rel);
    else if (tracked.has(rel)) toRestore.push(rel);
    else toDelete.push(rel); // 未跟踪
  }

  return runOp(async () => {
    const g = gitFor(workDir);

    if (toRestore.length > 0) {
      // 必须先取消暂存，否则 checkout 会从暂存区恢复，达不到「整回到 HEAD」
      const u = await unstage(workDir, toRestore);
      if (!u.ok) throw new Error(u.error);
      await g.checkout(['--', ...toRestore]);
    }

    // A 文件要先从索引移出，否则它仍是已暂存状态
    const addedToDelete = toDelete.filter((rel) => addedStaged.has(rel));
    if (addedToDelete.length > 0) {
      const u = await unstage(workDir, addedToDelete);
      if (!u.ok) throw new Error(u.error);
    }

    for (const rel of toDelete) {
      const abs = resolveInside(workDir, rel);
      if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
    }
  });
}

/** 与 files.ts 保持一致的单文件文本上限；超过则截断标记 */
export const MAX_TEXT_SIZE = 1024 * 1024;

export async function commit(workDir: string, message: string): Promise<GitOpResult> {
  const msg = message.trim();
  if (!msg) return { ok: false, error: '提交说明不能为空' };
  return runOp(() => gitFor(workDir).commit(msg));
}

/** fetch / pull / push。耗时可能较长，调用方负责禁用按钮防重复触发。 */
export async function remoteOp(
  workDir: string,
  op: 'fetch' | 'pull' | 'push',
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    const g = gitFor(workDir);
    if (op === 'fetch') {
      const r = await g.fetch();
      return { ok: true, summary: `fetch 完成（${r.remote ?? ''}）` };
    }
    if (op === 'pull') {
      const r = await g.pull();
      const changed = r.summary?.changes ?? 0;
      return { ok: true, summary: `pull 完成，更新 ${changed} 个文件` };
    }
    const r = await g.push();
    return { ok: true, summary: `push 完成（${r.pushed?.length ?? 0} 个分支）` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** 取某 revision 下某个文件的内容（diff 两侧靠它）。
 *  binary / 超大文件的处理策略与 files.ts 的 readFileEntry 一致。
 *  这里**刻意不用** simple-git 的 raw()：它默认按 utf8 解码，二进制内容会被破坏，
 *  而这个函数的调用方（diff 视图）需要靠原始字节判断二进制。 */
export async function fileAtRev(
  workDir: string,
  rev: string,
  relPath: string,
): Promise<
  | { ok: true; content: string; binary: boolean; truncated: boolean }
  | { ok: false; error: string }
> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${rev}:${relPath}`], {
      cwd: workDir,
      encoding: 'buffer',
      // 4MB 上限：超过它 execFile 会 kill 子进程并 reject，转成 { ok:false, error }。
      // 这与 files.ts 的 readFileEntry 在超限文件上的行为不同（那边稳定返回 truncated:true）——
      // 这里有意从简：diff 场景下源文件极少超过 4MB，报错比截断更能暴露异常。
      maxBuffer: MAX_TEXT_SIZE * 4,
    });
    const data = stdout as unknown as Buffer;

    if (data.subarray(0, 8192).includes(0)) {
      return { ok: true, content: '', binary: true, truncated: false };
    }
    if (data.length > MAX_TEXT_SIZE) {
      return {
        ok: true,
        content: data.subarray(0, MAX_TEXT_SIZE).toString('utf8'),
        binary: false,
        truncated: true,
      };
    }
    return { ok: true, content: data.toString('utf8'), binary: false, truncated: false };
  } catch (err: any) {
    // 文件在该 revision 不存在（新增文件取 HEAD 版本）是正常情况
    return { ok: false, error: err?.message || String(err) };
  }
}
