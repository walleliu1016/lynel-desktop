import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// 预热：下面每条用例各自 `await import('../../src/main/git.js')`，**排第一的那条**要替整个
// 文件付一次 git.js / simple-git / chokidar 的模块加载 —— 这笔开销记在它的用例超时里，
// 冷启动的 CI runner 上足以把它拖爆（现象是第一条超时、后面全过）。在模块作用域先引一次，
// 把加载挪到收集阶段（那一阶段没有用例超时），各用例拿到的就是缓存。
import '../../src/main/git.js';

/** 建一个真实的临时 git 仓库；git 操作类测试不用 mock —— mock 掉的正是被测对象 */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-git-'));
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init']);
  run(['config', 'user.name', 'lynel-test']);
  run(['config', 'user.email', 'test@lynel.local']);
  // 关掉换行符转换：Windows 上 Git 默认 core.autocrlf=true（系统级），
  // checkout 会把 LF 转成 CRLF，导致断言文件内容（如 'v1\n'）的用例在平台间不确定
  run(['config', 'core.autocrlf', 'false']);
  run(['commit', '--allow-empty', '-m', 'init']);
  return dir;
}

describe('git', () => {
  let repo: string;

  beforeAll(() => {
    repo = makeRepo();
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });


  it('干净仓库：报告分支且无变更', async () => {
    const { getStatus } = await import('../../src/main/git.js');
    const res = await getStatus(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.isRepo).toBe(true);
    expect(res.data.branch).toBeTruthy();
    expect(res.data.staged).toEqual([]);
    expect(res.data.unstaged).toEqual([]);
    expect(res.data.untracked).toEqual([]);
  });

  it('区分未跟踪 / 未暂存 / 已暂存', async () => {
    const { getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'a\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'add tracked'], { cwd: repo });
    // 提交后再改，制造未暂存
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'b\n');
    // 再制造一个已暂存的
    fs.writeFileSync(path.join(repo, 'staged.txt'), 's\n');
    execFileSync('git', ['add', 'staged.txt'], { cwd: repo });

    const res = await getStatus(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.untracked.map((f) => f.path)).toContain('untracked.txt');
    expect(res.data.unstaged.map((f) => f.path)).toContain('tracked.txt');
    expect(res.data.unstaged.find((f) => f.path === 'tracked.txt')?.status).toBe('M');
    expect(res.data.staged.map((f) => f.path)).toContain('staged.txt');
    expect(res.data.staged.find((f) => f.path === 'staged.txt')?.status).toBe('A');
  });
});

describe('git 变更操作', () => {
  let repo: string;
  // 危险路径（MM 文件、A 文件、路径越界）各自用独立仓库，避免相互污染
  let mmRepo: string;
  let addRepo: string;
  let escRepo: string;
  const sh = (args: string[], cwd: string = repo) =>
    execFileSync('git', args, { cwd, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    sh(['add', 'a.txt']);
    sh(['commit', '-m', 'add a']);

    // MM：已暂存，工作区又改（index='M'、working_dir='M'）
    mmRepo = makeRepo();
    fs.writeFileSync(path.join(mmRepo, 'm.txt'), 'v1\n');
    sh(['add', 'm.txt'], mmRepo);
    sh(['commit', '-m', 'add m'], mmRepo);
    fs.writeFileSync(path.join(mmRepo, 'm.txt'), 'staged\n');
    sh(['add', 'm.txt'], mmRepo);
    fs.writeFileSync(path.join(mmRepo, 'm.txt'), 'working\n');

    // A：新增且已暂存（无 HEAD 版本可还原）
    addRepo = makeRepo();

    // 路径越界用例的空仓库
    escRepo = makeRepo();
  });

  afterAll(() => {
    for (const r of [repo, mmRepo, addRepo, escRepo]) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it('stage 把未跟踪文件移入暂存区', async () => {
    const { stage, getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'n\n');
    expect((await stage(repo, ['new.txt'])).ok).toBe(true);
    const s = await getStatus(repo);
    expect(s.ok && s.data.staged.map((f) => f.path)).toContain('new.txt');
    expect(s.ok && s.data.untracked.map((f) => f.path)).not.toContain('new.txt');
  });

  it('unstage 把暂存文件移回工作区', async () => {
    const { unstage, getStatus } = await import('../../src/main/git.js');
    expect((await unstage(repo, ['new.txt'])).ok).toBe(true);
    const s = await getStatus(repo);
    expect(s.ok && s.data.staged.map((f) => f.path)).not.toContain('new.txt');
    expect(s.ok && s.data.untracked.map((f) => f.path)).toContain('new.txt');
  });

  it('discard 把已跟踪文件的改动还原到 HEAD', async () => {
    const { discard, getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'CHANGED\n');
    let s = await getStatus(repo);
    expect(s.ok && s.data.unstaged.map((f) => f.path)).toContain('a.txt');

    expect((await discard(repo, ['a.txt'])).ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('v1\n');
    s = await getStatus(repo);
    expect(s.ok && s.data.unstaged.map((f) => f.path)).not.toContain('a.txt');
  });

  it('discard 对未跟踪文件：删除它', async () => {
    const { discard } = await import('../../src/main/git.js');
    const p = path.join(repo, 'to-delete.txt');
    fs.writeFileSync(p, 'x\n');
    expect((await discard(repo, ['to-delete.txt'])).ok).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('对非仓库返回 ok=false 而不是抛错', async () => {
    const { stage } = await import('../../src/main/git.js');
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-nogit2-'));
    const res = await stage(plain, ['whatever.txt']);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe('string');
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('discard 对已暂存且工作区又改的文件（MM）：整回到 HEAD 而不是被删掉', async () => {
    const { discard, getStatus } = await import('../../src/main/git.js');
    const p = path.join(mmRepo, 'm.txt');

    const before = await getStatus(mmRepo);
    expect(before.ok && before.data.staged.find((f) => f.path === 'm.txt')?.status).toBe('M');
    expect(before.ok && before.data.unstaged.find((f) => f.path === 'm.txt')?.status).toBe('M');

    expect((await discard(mmRepo, ['m.txt'])).ok).toBe(true);

    // 文件必须还在，且内容回到 HEAD 版本（暂存区与工作区都清空）
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toBe('v1\n');
    const after = await getStatus(mmRepo);
    expect(after.ok && after.data.staged.map((f) => f.path)).not.toContain('m.txt');
    expect(after.ok && after.data.unstaged.map((f) => f.path)).not.toContain('m.txt');
  });

  it('discard 对新增且已暂存的文件（A）：删除它', async () => {
    const { discard, getStatus } = await import('../../src/main/git.js');
    const p = path.join(addRepo, 'added.txt');
    fs.writeFileSync(p, 'brand new\n');
    sh(['add', 'added.txt'], addRepo);

    const before = await getStatus(addRepo);
    expect(before.ok && before.data.staged.find((f) => f.path === 'added.txt')?.status).toBe('A');

    expect((await discard(addRepo, ['added.txt'])).ok).toBe(true);

    expect(fs.existsSync(p)).toBe(false);
    const after = await getStatus(addRepo);
    expect(after.ok && after.data.staged.map((f) => f.path)).not.toContain('added.txt');
    expect(after.ok && after.data.untracked.map((f) => f.path)).not.toContain('added.txt');
  });

  it('discard 对干净且已跟踪的文件：拒绝而不是删掉它', async () => {
    const { discard } = await import('../../src/main/git.js');
    // 独立仓库：该文件的路径必须「干净且已跟踪」，不受同 describe 其他用例的状态污染。
    // 场景来源：用户点「丢弃」弹出确认框期间，Claude 在后台 add + commit 了该文件，
    // 等用户点确定时它已不在任何变更分组里 —— 旧实现会走 else 分支 rmSync 掉它。
    const cleanRepo = makeRepo();
    try {
      const p = path.join(cleanRepo, 'committed.txt');
      fs.writeFileSync(p, 'committed\n');
      sh(['add', 'committed.txt'], cleanRepo);
      sh(['commit', '-m', 'commit it'], cleanRepo);

      // 干净树：committed.txt 不在 staged/unstaged/untracked/conflicted 任何一组里
      const res = await discard(cleanRepo, ['committed.txt']);
      expect(res.ok).toBe(false);
      // 最关键的断言：文件必须还在，内容不变
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('committed\n');
    } finally {
      fs.rmSync(cleanRepo, { recursive: true, force: true });
    }
  });

  it('discard 拒绝越界路径，且不删除工作目录外的文件', async () => {
    const { discard } = await import('../../src/main/git.js');
    // 哨兵放在仓库的父目录（os.tmpdir()），rel 用 `../<name>` 指过去
    const sentinel = path.join(os.tmpdir(), `lynel-outside-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(sentinel, 'safe\n');
    try {
      const res = await discard(escRepo, [`../${path.basename(sentinel)}`]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('路径越界');
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(sentinel, { force: true });
    }
  });
});

describe('git 提交 / 取版本 / 远程', () => {
  let repo: string;
  const sh = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'one\n');
    sh(['add', 'f.txt']);
    sh(['commit', '-m', 'first']);
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('commit 用给定 message 提交暂存区', async () => {
    const { commit, getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'two\n');
    sh(['add', 'f.txt']);
    const res = await commit(repo, 'second commit');
    expect(res.ok).toBe(true);
    const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(log).toBe('second commit');
    const s = await getStatus(repo);
    expect(s.ok && s.data.staged).toEqual([]);
  });

  it('commit 空 message 直接拒绝，不产生提交', async () => {
    const { commit } = await import('../../src/main/git.js');
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const res = await commit(repo, '   ');
    expect(res.ok).toBe(false);
    // 必须命中「我们自己的中文 guard 文案」。若 guard 被删掉、把空白串直接交给 git：
    //  - 仓库有暂存内容时，git 以 "Aborting commit due to empty commit message." 中止
    //    （ok=false，但错误文案来自 git，不含我们的提示）；
    //  - 工作区干净时（本用例的实际状态），simple-git 会静默返回成功（ok=true）。
    // 断言文案才能把「我们的 guard 生效」与「git 自己兜底 / 空操作」区分开。
    if (!res.ok) expect(res.error).toContain('不能为空');
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(after).toBe(before);
  });

  it('fileAtRev 取 HEAD 历史版本，index 版本用 :0', async () => {
    const { fileAtRev } = await import('../../src/main/git.js');
    // 工作区改成 three，未暂存 → HEAD 仍是 two，index 也是 two
    fs.writeFileSync(path.join(repo, 'f.txt'), 'three\n');

    const head = await fileAtRev(repo, 'HEAD', 'f.txt');
    expect(head.ok && head.content).toBe('two\n');

    const index = await fileAtRev(repo, ':0', 'f.txt');
    expect(index.ok && index.content).toBe('two\n');

    // 暂存后 index 变成 three，HEAD 不变
    sh(['add', 'f.txt']);
    const index2 = await fileAtRev(repo, ':0', 'f.txt');
    expect(index2.ok && index2.content).toBe('three\n');
    const head2 = await fileAtRev(repo, 'HEAD', 'f.txt');
    expect(head2.ok && head2.content).toBe('two\n');
  });

  it('fileAtRev 对不存在的路径返回错误而非抛异常', async () => {
    const { fileAtRev } = await import('../../src/main/git.js');
    const res = await fileAtRev(repo, 'HEAD', 'nope.txt');
    expect(res.ok).toBe(false);
  });

  it('remoteOp 在没有远端时返回可读错误', async () => {
    const { remoteOp } = await import('../../src/main/git.js');
    const res = await remoteOp(repo, 'push');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });

  it('fileAtRev 对二进制文件返回 binary=true 且不返回内容', async () => {
    const { fileAtRev } = await import('../../src/main/git.js');
    const binPath = path.join(repo, 'logo.bin');
    // 含 NUL 字节 → 二进制判定；前 8KB 采样内即可命中
    fs.writeFileSync(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    sh(['add', 'logo.bin']);
    sh(['commit', '-m', 'add binary']);

    const res = await fileAtRev(repo, 'HEAD', 'logo.bin');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.binary).toBe(true);
    expect(res.content).toBe('');
    expect(res.truncated).toBe(false);
  });

  it('fileAtRev 对超过 1MB 的文本返回 truncated=true 且内容被截断', { timeout: 30000 }, async () => {
    const { fileAtRev, MAX_TEXT_SIZE } = await import('../../src/main/git.js');
    const bigPath = path.join(repo, 'big.txt');
    // 纯 ASCII 文本，长度略超阈值，保证不会命中二进制判定（无 NUL）
    const content = 'a'.repeat(MAX_TEXT_SIZE + 1024);
    fs.writeFileSync(bigPath, content, 'utf8');
    sh(['add', 'big.txt']);
    sh(['commit', '-m', 'add big file']);

    const res = await fileAtRev(repo, 'HEAD', 'big.txt');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.binary).toBe(false);
    expect(res.truncated).toBe(true);
    expect(res.content.length).toBe(MAX_TEXT_SIZE);
  });

  it('fileAtRev 按原始字节量长度：非法 UTF-8 文本不会因解码膨胀被误判超限', async () => {
    const { fileAtRev, MAX_TEXT_SIZE } = await import('../../src/main/git.js');
    const p = path.join(repo, 'latin1.txt');
    // 0x80 是孤立的 UTF-8 连续字节（非法序列）：解码为 1 个 U+FFFD，但重新用 utf8
    // 编码会膨胀成 3 字节（EF BF BD）。
    // 若实现走「先解码成字符串、再 re-encode 成 Buffer」这条路径（simple-git 的 raw() 正是
    // 如此），长度会被放大 3 倍越过 MAX_TEXT_SIZE，此处就会误报 truncated=true。
    // 正确实现直接在原始 Buffer 上量长度 —— 这正是「刻意不用 raw()」保住字节保真的意义。
    fs.writeFileSync(p, Buffer.alloc(MAX_TEXT_SIZE, 0x80));
    sh(['add', 'latin1.txt']);
    sh(['commit', '-m', 'add latin1']);

    const res = await fileAtRev(repo, 'HEAD', 'latin1.txt');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.binary).toBe(false); // 首 8KB 无 NUL，不命中二进制分支
    expect(res.truncated).toBe(false); // 原始字节长度恰为上限，不算超限
    expect(res.content.length).toBe(MAX_TEXT_SIZE);
  });
});

describe('git 提交历史图', () => {
  let repo: string;
  let empty: string;
  let plain: string;

  /** 在指定目录跑一条 git 命令 */
  const git = (dir: string, args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });

  const commit = (dir: string, msg: string) =>
    git(dir, ['commit', '--allow-empty', '-m', msg]);

  beforeAll(() => {
    // 复用 makeRepo：它已 init 并产出第一个 commit，且关闭了 autocrlf
    repo = makeRepo();
    // 空仓库：init 了但一个 commit 都没有（git log 会直接失败）
    empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-git-empty-'));
    git(empty, ['init']);
    plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-git-plain-'));
  });

  afterAll(() => {
    for (const d of [repo, empty, plain]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('按时间倒序列出提交，带出 hash / 短 hash / 作者 / 主题', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-m', 'feat: 第二个提交']);
    commit(repo, 'chore: 第三个提交');

    const { logGraph } = await import('../../src/main/git.js');
    const res = await logGraph(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.length).toBeGreaterThanOrEqual(3);
    // --graph 是倒序的：最新提交在最前
    expect(res.data[0].message).toBe('chore: 第三个提交');
    expect(res.data[1].message).toBe('feat: 第二个提交');
    expect(res.data[0].author).toBe('lynel-test');
    expect(res.data[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(res.data[0].hash.startsWith(res.data[0].shortHash)).toBe(true);
    expect(res.data[0].parents.length).toBeGreaterThanOrEqual(1);
    // 图形前缀要留着给前端画线，且含提交点
    expect(res.data[0].graphLine).toContain('*');
  });

  it('HEAD 装饰解析为 head 类型并带出分支名', async () => {
    const { logGraph } = await import('../../src/main/git.js');
    const res = await logGraph(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const headRef = res.data[0].refs.find((r) => r.type === 'head');
    expect(headRef).toBeDefined();
    expect(headRef?.name).toBeTruthy();
  });

  it('max 参数限制返回条数', async () => {
    const { logGraph } = await import('../../src/main/git.js');
    const res = await logGraph(repo, 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.length).toBe(1);
  });

  // 关键用例：--graph 会在 commit 之间插入纯图形行（只有连接线、不含字段）。
  // 若按固定 7 行切块而不跳过这些行，字段会整体错位（message 里混进 hash）。
  it('存在分支与合并提交时字段不错位', { timeout: 30000 }, async () => {
    git(repo, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(repo, 'f.txt'), 'f\n');
    git(repo, ['add', 'f.txt']);
    git(repo, ['commit', '-m', 'feat: 分支上的提交']);
    git(repo, ['checkout', '-']);
    commit(repo, 'chore: 主干上的提交');
    // --no-ff 保证一定产生合并提交，从而让 --graph 输出分叉 / 汇合线
    git(repo, ['merge', '--no-ff', '-m', 'merge: 合并 feature', 'feature']);

    const { logGraph } = await import('../../src/main/git.js');
    const res = await logGraph(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 每个条目都必须是完整的 40 位 hash —— 错位会让 message/author 落到 hash 字段上
    for (const c of res.data) {
      expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(c.shortHash).toMatch(/^[0-9a-f]{7,}$/);
      expect(c.author).toBe('lynel-test');
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(c.message.length).toBeGreaterThan(0);
    }
    // 合并提交有两个父提交
    const merge = res.data.find((c) => c.message.startsWith('merge:'));
    expect(merge).toBeDefined();
    expect(merge?.parents.length).toBe(2);
  });

  it('空仓库（尚无 commit）返回空数组而不是报错', async () => {
    const { logGraph } = await import('../../src/main/git.js');
    const res = await logGraph(empty);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([]);
  });

  it('非 git 目录返回空数组而不是抛错', async () => {
    const { logGraph } = await import('../../src/main/git.js');
    const res = await logGraph(plain);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([]);
  });
});

describe('git 单个提交详情', () => {
  let repo: string;

  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

  beforeAll(() => {
    repo = makeRepo();
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('返回提交元信息与新增文件列表', async () => {
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x\n');
    fs.writeFileSync(path.join(repo, 'y.txt'), 'y\n');
    git(['add', 'x.txt', 'y.txt']);
    git(['commit', '-m', 'feat: 新增两个文件']);
    const hash = head();

    const { commitDetail } = await import('../../src/main/git.js');
    const res = await commitDetail(repo, hash);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.hash).toBe(hash);
    expect(res.data.shortHash).toBe(hash.slice(0, 7));
    expect(res.data.message).toBe('feat: 新增两个文件');
    expect(res.data.author).toBe('lynel-test');
    expect(res.data.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.data.files.map((f) => f.path).sort()).toEqual(['x.txt', 'y.txt']);
    expect(res.data.files.every((f) => f.status === 'A')).toBe(true);
  });

  it('修改与删除的文件带出对应状态', async () => {
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x2\n');
    fs.rmSync(path.join(repo, 'y.txt'));
    git(['add', '-A']);
    git(['commit', '-m', 'fix: 改一个删一个']);
    const hash = head();

    const { commitDetail } = await import('../../src/main/git.js');
    const res = await commitDetail(repo, hash);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const byPath = new Map(res.data.files.map((f) => [f.path, f.status]));
    expect(byPath.get('x.txt')).toBe('M');
    expect(byPath.get('y.txt')).toBe('D');
  });

  it('重命名同时带出 path 与 oldPath', async () => {
    git(['mv', 'x.txt', 'z.txt']);
    git(['commit', '-m', 'refactor: 重命名']);
    const hash = head();

    const { commitDetail } = await import('../../src/main/git.js');
    const res = await commitDetail(repo, hash);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const renamed = res.data.files.find((f) => f.status === 'R');
    expect(renamed).toBeDefined();
    expect(renamed?.path).toBe('z.txt');
    expect(renamed?.oldPath).toBe('x.txt');
  });

  // 合并提交默认不输出 name-status（合并 diff 为空），靠 --first-parent 相对第一父比较
  it('合并提交也能列出文件', { timeout: 30000 }, async () => {
    git(['checkout', '-b', 'side']);
    fs.writeFileSync(path.join(repo, 'side.txt'), 's\n');
    git(['add', 'side.txt']);
    git(['commit', '-m', 'feat: 分支上的文件']);
    git(['checkout', '-']);
    git(['merge', '--no-ff', '-m', 'merge: 合并 side', 'side']);
    const hash = head();

    const { commitDetail } = await import('../../src/main/git.js');
    const res = await commitDetail(repo, hash);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.files.map((f) => f.path)).toContain('side.txt');
  });

  it('不存在的 revision 返回 ok=false 而不是抛错', async () => {
    const { commitDetail } = await import('../../src/main/git.js');
    const res = await commitDetail(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeTruthy();
  });
});

describe('git 分支', () => {
  let repo: string;

  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const currentBranch = () =>
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo }).toString().trim();

  beforeAll(() => {
    repo = makeRepo();
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('列出本地分支并标出当前分支', async () => {
    git(['branch', 'alpha']);

    const { branchList } = await import('../../src/main/git.js');
    const res = await branchList(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.map((b) => b.name)).toContain('alpha');
    expect(res.data.filter((b) => b.current).length).toBe(1);
    expect(res.data.every((b) => b.remote === false)).toBe(true);
  });

  it('branchCreate 新建并切过去', async () => {
    const { branchCreate, branchList } = await import('../../src/main/git.js');
    const res = await branchCreate(repo, 'feature-x');
    expect(res.ok).toBe(true);
    expect(currentBranch()).toBe('feature-x');

    const list = await branchList(repo);
    if (!list.ok) return;
    expect(list.data.find((b) => b.name === 'feature-x')?.current).toBe(true);
  });

  it('branchCheckout 切回已有分支', async () => {
    const { branchCheckout } = await import('../../src/main/git.js');
    const res = await branchCheckout(repo, 'alpha');
    expect(res.ok).toBe(true);
    expect(currentBranch()).toBe('alpha');
  });

  it('branchCreate 空白名字直接拒绝，不会建成一个奇怪的分支', async () => {
    const { branchCreate } = await import('../../src/main/git.js');
    const res = await branchCreate(repo, '   ');
    expect(res.ok).toBe(false);
  });

  it('branchDelete 删除已合并的分支', async () => {
    const { branchDelete, branchList } = await import('../../src/main/git.js');
    // feature-x 与 alpha 指向同一提交，属已合并
    const res = await branchDelete(repo, 'feature-x');
    expect(res.ok).toBe(true);

    const list = await branchList(repo);
    if (!list.ok) return;
    expect(list.data.map((b) => b.name)).not.toContain('feature-x');
  });

  it('未合并分支：-d 被拒绝，force 用 -D 才删得掉', async () => {
    git(['checkout', '-b', 'unmerged']);
    fs.writeFileSync(path.join(repo, 'u.txt'), 'u\n');
    git(['add', 'u.txt']);
    git(['commit', '-m', 'feat: 未合并的提交']);
    git(['checkout', 'alpha']);

    const { branchDelete } = await import('../../src/main/git.js');
    const soft = await branchDelete(repo, 'unmerged');
    expect(soft.ok).toBe(false);

    const forced = await branchDelete(repo, 'unmerged', true);
    expect(forced.ok).toBe(true);
  });
});

describe('git stash', () => {
  let repo: string;

  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
    git(['add', 'base.txt']);
    git(['commit', '-m', 'chore: 基线']);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('初始没有 stash', async () => {
    const { stashList } = await import('../../src/main/git.js');
    const res = await stashList(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([]);
  });

  it('stashPush 收走改动（含未跟踪文件）并解析出说明与分支', async () => {
    fs.writeFileSync(path.join(repo, 'base.txt'), 'base-modified\n');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');

    const { stashPush, stashList } = await import('../../src/main/git.js');
    const push = await stashPush(repo, '我的说明');
    expect(push.ok).toBe(true);

    // 工作区被清干净：已跟踪文件回到 HEAD，未跟踪文件也被收走
    expect(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8')).toBe('base\n');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);

    const list = await stashList(repo);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.length).toBe(1);
    expect(list.data[0].index).toBe(0);
    expect(list.data[0].message).toBe('我的说明');
    expect(list.data[0].branch).toBeTruthy();
    expect(list.data[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stashPop 恢复改动并移除该条目', async () => {
    const { stashPop, stashList } = await import('../../src/main/git.js');
    const pop = await stashPop(repo);
    expect(pop.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8')).toBe('base-modified\n');

    const list = await stashList(repo);
    if (!list.ok) return;
    expect(list.data).toEqual([]);
  });

  it('stashDrop 丢弃条目不恢复改动', async () => {
    fs.writeFileSync(path.join(repo, 'base.txt'), 'again\n');

    const { stashPush, stashDrop, stashList } = await import('../../src/main/git.js');
    await stashPush(repo, '待丢弃');
    const drop = await stashDrop(repo, 0);
    expect(drop.ok).toBe(true);

    // 改动随 drop 一起消失，工作区停在干净状态
    expect(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8')).toBe('base\n');
    const list = await stashList(repo);
    if (!list.ok) return;
    expect(list.data).toEqual([]);
  });

  it('不带说明时自动 stash 的 reflog 文案也能解析出分支与说明', async () => {
    fs.writeFileSync(path.join(repo, 'base.txt'), 'auto\n');

    const { stashPush, stashList } = await import('../../src/main/git.js');
    await stashPush(repo);

    const list = await stashList(repo);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.length).toBe(1);
    // reflog 原文是「WIP on <branch>: <hash> <subject>」，branch/message 都必须剥干净
    expect(list.data[0].branch).toBeTruthy();
    expect(list.data[0].message.length).toBeGreaterThan(0);
    // 说明里不该残留 hash
    expect(list.data[0].message).not.toMatch(/^[0-9a-f]{7,40}\s/);
  });
});

describe('git blame', () => {
  let repo: string;

  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('逐行带出 hash / 作者 / 时间 / 主题', async () => {
    fs.writeFileSync(path.join(repo, 'blame.txt'), 'l1\nl2\nl3\n');
    git(['add', 'blame.txt']);
    git(['commit', '-m', 'feat: 三行文件']);

    const { blameFile } = await import('../../src/main/git.js');
    const res = await blameFile(repo, 'blame.txt');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.length).toBe(3);
    expect(res.data.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
    for (const l of res.data) {
      expect(l.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(l.hash.startsWith(l.shortHash)).toBe(true);
      expect(l.author).toBe('lynel-test');
      expect(l.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(l.summary).toBe('feat: 三行文件');
    }
  });

  // 关键用例：porcelain 对同一 commit 只在首次给出元信息，后续行只有块头。
  // 不做按 hash 缓存就会让后面的行继承「上一个出现的 commit」的作者 —— 静默错误归因。
  it('同一提交的多行都归到正确作者；跨提交后旧提交的行不被新作者污染', async () => {
    // 追加一行，产生第二个提交
    fs.appendFileSync(path.join(repo, 'blame.txt'), 'l4\n');
    git(['add', 'blame.txt']);
    git([
      '-c',
      'user.name=second-author',
      '-c',
      'user.email=second@lynel.local',
      'commit',
      '-m',
      'feat: 追加第四行',
    ]);

    const { blameFile } = await import('../../src/main/git.js');
    const res = await blameFile(repo, 'blame.txt');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.length).toBe(4);
    // 前三行仍属第一次提交（同一 commit 的后续行只有块头，必须命中缓存）
    for (const l of res.data.slice(0, 3)) {
      expect(l.author).toBe('lynel-test');
      expect(l.summary).toBe('feat: 三行文件');
    }
    // 第四行属第二次提交
    const last = res.data[3];
    expect(last.author).toBe('second-author');
    expect(last.summary).toBe('feat: 追加第四行');
    // 两次提交的 hash 必须不同，否则上面的作者断言其实没区分开
    expect(last.hash).not.toBe(res.data[0].hash);
  });

  it('未跟踪文件返回空数组而不是报错', async () => {
    fs.writeFileSync(path.join(repo, 'untracked-blame.txt'), 'x\n');

    const { blameFile } = await import('../../src/main/git.js');
    const res = await blameFile(repo, 'untracked-blame.txt');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([]);
  });

  it('非 git 目录返回空数组而不是抛错', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-blame-plain-'));
    try {
      const { blameFile } = await import('../../src/main/git.js');
      const res = await blameFile(plain, 'whatever.txt');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data).toEqual([]);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('git reset', () => {
  let repo: string;
  let base: string;

  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

  /** 造出「第二次提交 + 一个已暂存改动」的现场，三种 reset 都对它下手 */
  function makeSecondCommitWithStagedChange() {
    fs.writeFileSync(path.join(repo, 'r.txt'), 'v2\n');
    git(['add', 'r.txt']);
    git(['commit', '-m', 'feat: 第二次']);
    fs.writeFileSync(path.join(repo, 'r.txt'), 'v3\n');
    git(['add', 'r.txt']);
  }

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'r.txt'), 'v1\n');
    git(['add', 'r.txt']);
    git(['commit', '-m', 'chore: 第一次']);
    base = head();
  });

  beforeEach(() => {
    // 每个用例都从「初始提交 + 干净工作区」开始，避免用例间互相污染
    git(['reset', '--hard', base]);
    git(['clean', '-fd']);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('soft：只移动 HEAD，已暂存的改动原样留在索引里', async () => {
    makeSecondCommitWithStagedChange();

    const { resetTo, getStatus } = await import('../../src/main/git.js');
    const res = await resetTo(repo, 'HEAD~1', 'soft');
    expect(res.ok).toBe(true);
    expect(head()).toBe(base);

    // 索引没被动过 → 相对新 HEAD 仍是一条「已暂存修改」
    const st = await getStatus(repo);
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    expect(st.data.staged.map((f) => f.path)).toContain('r.txt');
  });

  it('mixed：索引被重置，改动退回未暂存', async () => {
    makeSecondCommitWithStagedChange();

    const { resetTo, getStatus } = await import('../../src/main/git.js');
    const res = await resetTo(repo, 'HEAD~1', 'mixed');
    expect(res.ok).toBe(true);
    expect(head()).toBe(base);

    const st = await getStatus(repo);
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    expect(st.data.staged).toEqual([]);
    expect(st.data.unstaged.map((f) => f.path)).toContain('r.txt');
  });

  it('hard：索引与工作区的改动一并丢弃', async () => {
    fs.writeFileSync(path.join(repo, 'r.txt'), 'dirty\n');
    fs.writeFileSync(path.join(repo, 'extra.txt'), 'x\n');
    git(['add', 'extra.txt']);

    const { resetTo, getStatus } = await import('../../src/main/git.js');
    const res = await resetTo(repo, 'HEAD', 'hard');
    expect(res.ok).toBe(true);

    // 已跟踪文件回到 HEAD 版本
    expect(fs.readFileSync(path.join(repo, 'r.txt'), 'utf8')).toBe('v1\n');
    const st = await getStatus(repo);
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    expect(st.data.staged).toEqual([]);
    expect(st.data.unstaged).toEqual([]);
  });

  it('不存在的 revision 返回 ok=false 而不是抛错', async () => {
    const { resetTo } = await import('../../src/main/git.js');
    const res = await resetTo(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'soft');
    expect(res.ok).toBe(false);
  });
});
