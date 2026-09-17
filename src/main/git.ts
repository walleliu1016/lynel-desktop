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
import { ipcMain } from 'electron';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { simpleGit, type SimpleGit } from 'simple-git';
import { getBus } from './events.js';
import { getLogger } from './log.js';

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

/** 把相对路径安全解析到 workDir 内；越界抛错。
 *  这里**刻意比 files.ts 的 resolveEntry 更严**：那边放行 target === base，因为它的调用点
 *  都只接受 UI 选中条目、且不执行删除。本函数的调用点会对结果做 rmSync(recursive)，
 *  而 rel 为 '.' 或空串时 target === base 会解析到工作目录本身 —— 放行等于允许删掉整个
 *  工作目录。爆炸半径不该用「UI 不会这么传」来担保，故只允许严格位于工作目录内部的路径。 */
function resolveInside(workDir: string, rel: string): string {
  const base = path.resolve(workDir);
  const target = path.resolve(base, rel);
  if (!target.startsWith(base + path.sep)) {
    throw new Error(`路径越界: ${rel}`);
  }
  return target;
}

/** 丢弃工作区改动：已跟踪文件 checkout 还原；未跟踪文件直接删除。
 *  调用方（渲染进程）必须先做二次确认 —— 这是不可逆操作。 */
export async function discard(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return { ok: true };

  // 先把所有路径解析到工作目录内的绝对路径。越界必须在任何磁盘操作前就拒绝，且
  // 越界的报错要优先于下面「无可丢弃的变更」—— 否则一条 ../ 路径会先被分组兜底拦下，
  // 报出「无变更」而掩盖了越界这个更严重的问题。
  let resolved: Map<string, string>;
  try {
    resolved = new Map(relPaths.map((rel) => [rel, resolveInside(workDir, rel)]));
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }

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
  // 只有确认是未跟踪，才允许删除
  const untracked = new Set(s.untracked.map((f) => f.path));

  const toRestore: string[] = [];
  const toDelete: string[] = [];
  for (const rel of relPaths) {
    if (addedStaged.has(rel)) toDelete.push(rel);
    else if (tracked.has(rel)) toRestore.push(rel);
    else if (untracked.has(rel)) toDelete.push(rel);
    // 不在任何分组里 = 该文件已干净（无变更可丢弃），或状态在二次确认期间被外部改变
    // （如 Claude 在后台 add + commit 了它）。绝不能当作未跟踪删除 —— 那会把用户刚提交
    // 的文件从磁盘删掉。fail-closed。
    else return { ok: false, error: `无可丢弃的变更: ${rel}` };
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
      const abs = resolved.get(rel);
      if (abs && fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
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

// —— 提交历史图 ——

/** 提交上的 ref 装饰（分支 / 远程分支 / 标签 / HEAD） */
export interface GitGraphRef {
  type: 'head' | 'branch' | 'remote' | 'tag'
  name: string
}

export interface GitGraphCommit {
  hash: string
  shortHash: string
  author: string
  /** ISO 8601 提交时间，前端自行格式化为相对时间 */
  date: string
  message: string
  refs: GitGraphRef[]
  parents: string[]
  /** `git log --graph` 给出的图形前缀（`* | \ /` 等）。原样交给前端按等宽字体渲染 */
  graphLine: string
}

/** 历史图一次取多少条。200 条足够覆盖日常回溯，且解析与渲染开销都很小 */
export const MAX_LOG = 200;

/** 剥离 `git log --graph` 的图形前缀（`* | / \ _` 与空格），同时返回前缀本身。
 *  图形行与数据行都带前缀：commit 行的前缀要留着画图，其余行的前缀要丢掉。 */
function splitGraphPrefix(line: string): { prefix: string; content: string } {
  const m = /^[*|/\\_ ]*/.exec(line);
  const prefix = m ? m[0] : '';
  return { prefix, content: line.slice(prefix.length) };
}

/** 解析 `--decorate=full` 的 `%D` 输出（如 `HEAD -> refs/heads/main, refs/tags/v1`） */
function parseDecorations(raw: string): GitGraphRef[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map<GitGraphRef>((s) => {
      // `HEAD -> refs/heads/x`：当前检出的分支，同时是 HEAD
      if (s.startsWith('HEAD -> ')) {
        return { type: 'head', name: s.slice('HEAD -> '.length).replace(/^refs\/heads\//, '') };
      }
      if (s === 'HEAD') return { type: 'head', name: 'HEAD' };
      if (s.startsWith('refs/heads/')) return { type: 'branch', name: s.slice('refs/heads/'.length) };
      if (s.startsWith('refs/remotes/')) return { type: 'remote', name: s.slice('refs/remotes/'.length) };
      if (s.startsWith('refs/tags/')) return { type: 'tag', name: s.slice('refs/tags/'.length) };
      // 兜底：认不出的当普通分支名展示，总比丢掉信息好
      return { type: 'branch', name: s };
    });
}

/**
 * 解析 `git log --graph --format=%H%n%h%n%P%n%an%n%aI%n%s%n%D` 的输出。
 *
 * 每个 commit 恰好占 7 行（hash / shortHash / parents / author / date / subject /
 * decorations），但 `--graph` 会在 commit 之间插入**纯图形行**（只有连接线、没有数据）
 * 用于画分叉与合并。因此不能简单地按 7 行切块 —— 必须先判断当前行的前缀后面
 * 是否真的有内容：没有就是图形行，跳过一行即可（它不携带任何字段，不会让后续错位）。
 */
function parseLogGraph(output: string): GitGraphCommit[] {
  const lines = output.split('\n');
  const commits: GitGraphCommit[] = [];
  let i = 0;
  while (i + 6 < lines.length) {
    const first = splitGraphPrefix(lines[i]);
    if (!first.content) {
      // 纯图形行（分叉 / 合并的连接线），不含字段
      i++;
      continue;
    }
    const parentsRaw = splitGraphPrefix(lines[i + 2]).content;
    commits.push({
      hash: first.content,
      shortHash: splitGraphPrefix(lines[i + 1]).content,
      parents: parentsRaw.split(/\s+/).filter(Boolean),
      author: splitGraphPrefix(lines[i + 3]).content,
      date: splitGraphPrefix(lines[i + 4]).content,
      message: splitGraphPrefix(lines[i + 5]).content,
      refs: parseDecorations(splitGraphPrefix(lines[i + 6]).content),
      graphLine: first.prefix,
    });
    i += 7;
  }
  return commits;
}

/** 取提交历史图。空仓库（尚无任何 commit）与「非 git 目录」都返回空数组，
 *  这两种都是正常的用户状态，不该当作错误弹给用户。 */
export async function logGraph(
  workDir: string,
  max: number = MAX_LOG,
): Promise<{ ok: true; data: GitGraphCommit[] } | { ok: false; error: string }> {
  try {
    const out = await gitFor(workDir).raw([
      'log',
      '--graph',
      '--decorate=full',
      '--format=%H%n%h%n%P%n%an%n%aI%n%s%n%D',
      `-${max}`,
    ]);
    return { ok: true, data: parseLogGraph(out) };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/not a git repository/i.test(msg)) return { ok: true, data: [] };
    // 全新仓库还没有 HEAD，`git log` 会报这几类错，属于正常状态
    if (/does not have any commits|does not have a commit|unknown revision|bad default revision|your current branch .* does not have any commits/i.test(msg)) {
      return { ok: true, data: [] };
    }
    return { ok: false, error: msg };
  }
}

// —— 单个提交的详情 ——

export interface GitCommitFile {
  /** 复用变更列表同一套状态字母，前端可直接套用现有配色 */
  status: GitFileStatus;
  path: string;
  /** 重命名 / 复制时的原路径 */
  oldPath?: string;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  files: GitCommitFile[];
}

/** `git show --name-status` 的状态字母归一化。T（类型变更）/ X / B 都归入 M，
 *  避免前端出现它不认识的状态。 */
function normalizeCommitStatus(raw: string): GitFileStatus {
  const c = raw.trim().charAt(0).toUpperCase();
  if (c === 'A' || c === 'D' || c === 'R' || c === 'C' || c === 'U' || c === 'M') return c;
  return 'M';
}

/** 解析 `git show --name-status` 输出。前 5 行是 --format 的字段，其后是
 *  `<status>\t<path>`（重命名/复制为 `<status>\t<oldPath>\t<newPath>`）。
 *
 *  加 `--first-parent`：合并提交与第一父的对比才有文件列表，否则 `git show` 对
 *  merge 提交不输出任何 name-status，点开就是一片空白。 */
export async function commitDetail(
  workDir: string,
  hash: string,
): Promise<{ ok: true; data: GitCommitInfo } | { ok: false; error: string }> {
  try {
    const out = await gitFor(workDir).raw([
      'show',
      '--first-parent',
      '--name-status',
      '--format=%H%n%h%n%an%n%aI%n%s',
      hash,
    ]);
    const lines = out.split('\n');
    const files: GitCommitFile[] = [];
    for (let i = 5; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const status = normalizeCommitStatus(parts[0]);
      if ((status === 'R' || status === 'C') && parts.length >= 3) {
        files.push({ status, path: parts[2], oldPath: parts[1] });
      } else {
        files.push({ status, path: parts[1] });
      }
    }
    return {
      ok: true,
      data: {
        hash: lines[0] ?? hash,
        shortHash: lines[1] ?? hash.slice(0, 7),
        author: lines[2] ?? '',
        date: lines[3] ?? '',
        message: lines[4] ?? '',
        files,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// —— 分支 ——

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  /** 跟踪的上游分支（如 origin/main），无则为 null */
  upstream: string | null;
  /** 最后一次提交的「短 hash + 主题」，列表里作为副标题 */
  lastCommit: string;
}

/** `git branch --format` 的字段分隔符。分支名允许出现的字符里包含 `|`，
 *  但实践中极其罕见；换成 NUL 反而会让 git 的 --format 解析变复杂。 */
const BRANCH_FORMAT =
  '--format=%(HEAD)|%(refname)|%(refname:short)|%(upstream:short)|%(objectname:short)|%(subject)';

function parseBranches(output: string): GitBranchInfo[] {
  const list: GitBranchInfo[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < 6) continue;
    const refname = parts[1];
    // remote 不能用「名字里有没有 /」判断：本地分支同样可以是 feature/x
    const remote = refname.startsWith('refs/remotes/');
    // `refs/remotes/origin/HEAD` 是符号引用，不是真分支
    if (refname.endsWith('/HEAD')) continue;
    list.push({
      name: parts[2],
      current: parts[0].trim() === '*',
      remote,
      upstream: parts[3] || null,
      lastCommit: `${parts[4]} ${parts[5]}`.trim(),
    });
  }
  return list;
}

export async function branchList(
  workDir: string,
  includeRemote = false,
): Promise<{ ok: true; data: GitBranchInfo[] } | { ok: false; error: string }> {
  try {
    const args = ['branch', BRANCH_FORMAT];
    if (includeRemote) args.push('-a');
    const out = await gitFor(workDir).raw(args);
    return { ok: true, data: parseBranches(out) };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // 空仓库（尚无 commit）没有分支可列，属正常状态
    if (/not a git repository|does not have any commits/i.test(msg)) {
      return { ok: true, data: [] };
    }
    return { ok: false, error: msg };
  }
}

/** 新建分支并切过去（等价 `git checkout -b`）。 */
export function branchCreate(
  workDir: string,
  name: string,
  startPoint?: string,
): Promise<GitOpResult> {
  const branch = name.trim();
  if (!branch) return Promise.resolve({ ok: false, error: '分支名不能为空' });
  return runOp(() => {
    const args = ['checkout', '-b', branch];
    if (startPoint) args.push(startPoint);
    return gitFor(workDir).raw(args);
  });
}

/** 切换分支。工作区有冲突性改动时 git 会自行拒绝，错误原样回给调用方。 */
export function branchCheckout(workDir: string, name: string): Promise<GitOpResult> {
  return runOp(() => gitFor(workDir).checkout(name));
}

/** 删除本地分支。force 对应 `-D`（未合并也删）。 */
export function branchDelete(
  workDir: string,
  name: string,
  force = false,
): Promise<GitOpResult> {
  return runOp(() => gitFor(workDir).raw(['branch', force ? '-D' : '-d', name]));
}

export type GitResetMode = 'soft' | 'mixed' | 'hard';

/** 把当前分支重置到某个提交。
 *  - `soft`：只移动 HEAD，索引与工作区都不动
 *  - `mixed`：移动 HEAD 并重置索引，工作区改动保留（变成未暂存）
 *  - `hard`：连索引与工作区一起丢弃 —— **不可逆**
 *
 *  `hard` 的确认责任在调用方：前端必须先做二次确认再发这个请求。 */
export function resetTo(
  workDir: string,
  hash: string,
  mode: GitResetMode,
): Promise<GitOpResult> {
  return runOp(() => gitFor(workDir).raw(['reset', `--${mode}`, hash]));
}

// —— stash ——

export interface GitStashEntry {
  index: number;
  /** 创建 stash 时所在的分支 */
  branch: string;
  message: string;
  date: string;
}

/** 解析 `git stash list --format=%gd%n%gs%n%aI`。
 *  `%gs`（reflog subject）形如：
 *    - `WIP on main: 1a2b3c4 提交主题`（自动 stash）
 *    - `On main: 我的说明`（`stash push -m`）
 *  两种前缀都要剥掉，只留分支名与用户可见的说明。 */
function parseStashList(output: string): GitStashEntry[] {
  const lines = output.split('\n');
  const entries: GitStashEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const ref = lines[i];
    if (!ref.trim()) break;
    const raw = lines[i + 1];
    const date = lines[i + 2];
    const index =
      Number(/^stash@\{(\d+)\}$/.exec(ref.trim())?.[1] ?? '0') || 0;
    const rest = raw.startsWith('WIP on ') ? raw.slice('WIP on '.length) : raw.startsWith('On ') ? raw.slice('On '.length) : raw;
    const sep = rest.indexOf(': ');
    const branch = sep >= 0 ? rest.slice(0, sep) : '';
    // 自动 stash 的说明带 `<hash> <subject>`，hash 对用户没意义，去掉
    let message = sep >= 0 ? rest.slice(sep + 2) : rest;
    message = message.replace(/^[0-9a-f]{7,40}\s+/, '');
    entries.push({ index, branch, message, date });
  }
  return entries;
}

export async function stashList(
  workDir: string,
): Promise<{ ok: true; data: GitStashEntry[] } | { ok: false; error: string }> {
  try {
    const out = await gitFor(workDir).raw(['stash', 'list', '--format=%gd%n%gs%n%aI']);
    return { ok: true, data: parseStashList(out) };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/not a git repository/i.test(msg)) return { ok: true, data: [] };
    return { ok: false, error: msg };
  }
}

/** 暂存当前改动。默认带上未跟踪文件（`-u`）——否则新建的文件会被留在工作区，
 *  与用户「把当前这些都收起来」的预期不符。 */
export function stashPush(workDir: string, message?: string): Promise<GitOpResult> {
  return runOp(() => {
    const args = ['stash', 'push', '-u'];
    if (message?.trim()) args.push('-m', message.trim());
    return gitFor(workDir).raw(args);
  });
}

/** 取出并删除指定 stash（`stash pop`）。index 省略即最近一条。 */
export function stashPop(workDir: string, index = 0): Promise<GitOpResult> {
  return runOp(() => gitFor(workDir).raw(['stash', 'pop', `stash@{${index}}`]));
}

/** 丢弃指定 stash（不可逆，调用方必须先二次确认）。 */
export function stashDrop(workDir: string, index = 0): Promise<GitOpResult> {
  return runOp(() => gitFor(workDir).raw(['stash', 'drop', `stash@{${index}}`]));
}

// —— blame ——

export interface GitBlameLine {
  /** 1-based 行号，对应文件当前内容 */
  lineNumber: number;
  hash: string;
  shortHash: string;
  author: string;
  /** ISO 8601 作者时间（porcelain 给的是 unix 秒，这里已换算） */
  date: string;
  /** 该行所属提交的主题 */
  summary: string;
}

/**
 * 解析 `git blame --porcelain` 输出。
 *
 * porcelain 的元信息（author / author-time / summary）**只在某个 commit 首次出现时输出**，
 * 之后引用同一 commit 的块只有一行块头。所以必须按 hash 缓存元信息 —— 否则后续行会
 * 继承上一个 commit 的作者，那是**静默的错误归因**，比直接报错危险得多。
 */
function parsePorcelainBlame(output: string): GitBlameLine[] {
  const meta = new Map<string, { author: string; date: string; summary: string }>();
  const result: GitBlameLine[] = [];
  let curHash = '';
  let curLine = 0;
  let pendingAuthor = '';
  let pendingDate = '';
  let pendingSummary = '';

  for (const line of output.split('\n')) {
    // 内容行（以 TAB 开头）→ 产出一行的归因。内容本身前端用不到，只要行号映射
    if (line.startsWith('\t')) {
      const cached = meta.get(curHash);
      result.push({
        lineNumber: curLine,
        hash: curHash,
        shortHash: curHash.slice(0, 7),
        author: cached?.author ?? pendingAuthor,
        date: cached?.date ?? pendingDate,
        summary: cached?.summary ?? pendingSummary,
      });
      continue;
    }

    // 块头：`<sha> <orig-line> <final-line> [<num-lines>]`
    const head = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (head) {
      curHash = head[1];
      curLine = Number(head[2]);
      pendingAuthor = '';
      pendingDate = '';
      pendingSummary = '';
      continue;
    }

    if (line.startsWith('author ')) {
      pendingAuthor = line.slice('author '.length);
    } else if (line.startsWith('author-time ')) {
      const secs = Number(line.slice('author-time '.length));
      pendingDate = Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : '';
    } else if (line.startsWith('summary ')) {
      pendingSummary = line.slice('summary '.length);
      // summary 是块内我们需要的最后一个字段，读到它就把这个 commit 的元信息落缓存
      meta.set(curHash, { author: pendingAuthor, date: pendingDate, summary: pendingSummary });
    }
  }
  return result;
}

export async function blameFile(
  workDir: string,
  relPath: string,
): Promise<{ ok: true; data: GitBlameLine[] } | { ok: false; error: string }> {
  try {
    const out = await gitFor(workDir).raw(['blame', '--porcelain', '--', relPath]);
    return { ok: true, data: parsePorcelainBlame(out) };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // 未跟踪 / 尚未提交的文件没有历史可 blame，属正常状态而非错误
    if (/no such path|no such file|has no commits yet|not a git repository/i.test(msg)) {
      return { ok: true, data: [] };
    }
    return { ok: false, error: msg };
  }
}

// —— .git 变更监听 ——
// files.ts 的文件树 watcher 把 .git 放在 IGNORED_DIRS 里，看不到 git 内部状态变化
// （提交、外部 checkout、切换分支），Git 面板必须自己盯 HEAD / index / refs。
// 刻意不监 objects/ 与 logs/：写入极频繁且与 UI 展示无关。
const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

export function watchGit(workDir: string): void {
  if (watchers.has(workDir)) return;
  const gitDir = `${workDir}/.git`;
  const w = chokidar.watch(
    [`${gitDir}/HEAD`, `${gitDir}/index`, `${gitDir}/refs`],
    { ignoreInitial: true, depth: 4 },
  );
  w.on('all', () => {
    const t = debounceTimers.get(workDir);
    if (t) clearTimeout(t);
    // 500ms 合帧：一次 git 操作会连写多个文件
    debounceTimers.set(
      workDir,
      setTimeout(() => getBus().emit('git:changed', workDir), 500),
    );
  });
  // 监听 chokidar 异步错误（EMFILE/ENOSPC/权限等），避免走向主进程未捕获异常路径
  w.on('error', (err) => getLogger().warn(`[git] watcher error ${workDir}: ${err}`));
  watchers.set(workDir, w);
}

/** 关闭全部 git watcher 及其 debounce 定时器，应用退出时调用。
 *  git 的 watcher 挂在模块级 Map 上（不归 App 实例管），shutdown 里的
 *  `watchCleanup` 只覆盖文件 watcher，漏掉这些会导致退出流程被拉长时
 *  chokidar 仍握着文件句柄。 */
export async function closeAllGitWatchers(): Promise<void> {
  await Promise.all([...watchers.keys()].map((d) => unwatchGit(d)));
}

export async function unwatchGit(workDir: string): Promise<void> {
  const w = watchers.get(workDir);
  if (w) {
    await w.close();
    watchers.delete(workDir);
  }
  const t = debounceTimers.get(workDir);
  if (t) {
    clearTimeout(t);
    debounceTimers.delete(workDir);
  }
}

// —— IPC ——
/** 所有以 workDir 为第一参数的 handler 都过这道守卫：空目录会让 simple-git 回退到
 *  process.cwd()（开发态即本仓库），可能把变更写进应用自己的仓库。
 *  渲染层已经拦过一次，这里是主进程侧的纵深防御 —— 主进程是最后一道防线。
 *  返回形状与各 channel 原有的错误分支一致（{ ok: false, error }），不改变成功路径。 */
function withWorkDir<T extends unknown[]>(
  fn: (workDir: string, ...args: T) => Promise<unknown>,
) {
  return async (_e: unknown, workDir: string, ...args: T) => {
    if (!workDir) return { ok: false, error: 'workDir 为空' };
    return fn(workDir, ...args);
  };
}

export function registerGitIpc(): void {
  ipcMain.handle('git:status', withWorkDir((workDir: string) => getStatus(workDir)));
  ipcMain.handle(
    'git:stage',
    withWorkDir((workDir: string, paths: string[]) => stage(workDir, paths)),
  );
  ipcMain.handle(
    'git:unstage',
    withWorkDir((workDir: string, paths: string[]) => unstage(workDir, paths)),
  );
  ipcMain.handle(
    'git:discard',
    withWorkDir((workDir: string, paths: string[]) => discard(workDir, paths)),
  );
  ipcMain.handle(
    'git:commit',
    withWorkDir((workDir: string, message: string) => commit(workDir, message)),
  );
  ipcMain.handle(
    'git:remoteOp',
    withWorkDir((workDir: string, op: 'fetch' | 'pull' | 'push') => remoteOp(workDir, op)),
  );
  ipcMain.handle(
    'git:fileAtRev',
    withWorkDir((workDir: string, rev: string, relPath: string) =>
      fileAtRev(workDir, rev, relPath),
    ),
  );
  ipcMain.handle(
    'git:logGraph',
    withWorkDir((workDir: string, max?: number) => logGraph(workDir, max)),
  );
  ipcMain.handle(
    'git:commitDetail',
    withWorkDir((workDir: string, hash: string) => commitDetail(workDir, hash)),
  );
  ipcMain.handle(
    'git:branchList',
    withWorkDir((workDir: string, includeRemote?: boolean) =>
      branchList(workDir, includeRemote),
    ),
  );
  ipcMain.handle(
    'git:branchCreate',
    withWorkDir((workDir: string, name: string, startPoint?: string) =>
      branchCreate(workDir, name, startPoint),
    ),
  );
  ipcMain.handle(
    'git:branchCheckout',
    withWorkDir((workDir: string, name: string) => branchCheckout(workDir, name)),
  );
  ipcMain.handle(
    'git:branchDelete',
    withWorkDir((workDir: string, name: string, force?: boolean) =>
      branchDelete(workDir, name, force),
    ),
  );
  ipcMain.handle(
    'git:stashList',
    withWorkDir((workDir: string) => stashList(workDir)),
  );
  ipcMain.handle(
    'git:stashPush',
    withWorkDir((workDir: string, message?: string) => stashPush(workDir, message)),
  );
  ipcMain.handle(
    'git:stashPop',
    withWorkDir((workDir: string, index?: number) => stashPop(workDir, index)),
  );
  ipcMain.handle(
    'git:stashDrop',
    withWorkDir((workDir: string, index?: number) => stashDrop(workDir, index)),
  );
  ipcMain.handle(
    'git:blame',
    withWorkDir((workDir: string, relPath: string) => blameFile(workDir, relPath)),
  );
  ipcMain.handle(
    'git:resetTo',
    withWorkDir((workDir: string, hash: string, mode: GitResetMode) =>
      resetTo(workDir, hash, mode),
    ),
  );
  ipcMain.handle(
    'git:watch',
    withWorkDir(async (workDir: string) => {
      watchGit(workDir);
      return { ok: true };
    }),
  );
  ipcMain.handle(
    'git:unwatch',
    withWorkDir(async (workDir: string) => {
      await unwatchGit(workDir);
      return { ok: true };
    }),
  );
}
