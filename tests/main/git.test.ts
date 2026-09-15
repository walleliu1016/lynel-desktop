import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
  let plain: string;

  beforeAll(() => {
    repo = makeRepo();
    plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-nogit-'));
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('非 git 目录返回 isRepo=false 而不是抛错', async () => {
    const { getStatus } = await import('../../src/main/git.js');
    const res = await getStatus(plain);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.isRepo).toBe(false);
      expect(res.data.staged).toEqual([]);
    }
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
});
