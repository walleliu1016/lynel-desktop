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
import { simpleGit, type SimpleGit } from 'simple-git';

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

const EMPTY_STATUS: GitStatusResult = {
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
      return { ok: true, data: { ...EMPTY_STATUS } };
    }
    return { ok: false, error: msg };
  }
}
