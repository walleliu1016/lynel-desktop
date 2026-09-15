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
  const sh = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    sh(['add', 'a.txt']);
    sh(['commit', '-m', 'add a']);
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

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
});
