import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  setRoot,
  scanAll,
  getSessionJsonlPath,
  watchProjects,
  encodeProjectDirName,
  decodeProjectDirName,
  clearFileMetaCache,
  scanFileMeta,
} from '../../src/main/jsonl.js';

describe('jsonl', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ease-jsonl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tmpDir, { recursive: true });
    setRoot(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('encodes and decodes project dir names', () => {
    expect(encodeProjectDirName('C:\\Users\\bruceliu')).toBe('C--Users-bruceliu');
    expect(decodeProjectDirName('C--Users-bruceliu')).toBe('C:\\Users\\bruceliu');
    expect(encodeProjectDirName('/Users/akke/foo')).toBe('-Users-akke-foo');
    expect(decodeProjectDirName('-Users-akke-foo')).toBe('/Users/akke/foo');
  });

  it('scans sessions', async () => {
    const workDir = '/work_a';
    const p = getSessionJsonlPath('sess-1', workDir);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(
      p,
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hello world' },
        ai_title: 'test-title',
        cwd: workDir,
      }) + '\n',
    );
    const list = await scanAll();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sess-1');
    expect(list[0].workdir).toBe(workDir);
    expect(list[0].project).toBe('work_a');
    expect(list[0].msg_count).toBe(1);
    expect(list[0].first_prompt).toBe('hello world');
    expect(list[0].ai_title).toBe('test-title');
    expect(list[0].size).toBeGreaterThan(0);
  });

  it('watches for changes', async () => {
    const p = getSessionJsonlPath('sess-watch', '/work_a');
    await fs.mkdir(path.dirname(p), { recursive: true });

    return new Promise<void>((resolve, reject) => {
      const unwatch = watchProjects(() => {
        unwatch().then(() => resolve()).catch(reject);
      });
      setTimeout(async () => {
        await fs.writeFile(p, JSON.stringify({ cwd: '/work_a' }) + '\n');
      }, 800);
    });
  }, 10000);

  it('scanFileMeta 缓存：mtime/size 未变直接命中，变化后失效', async () => {
    const workDir = '/work_cache';
    const p = getSessionJsonlPath('sess-cache', workDir);
    await fs.mkdir(path.dirname(p), { recursive: true });

    // 两行内容长度一致，仅 first_prompt 不同
    const line = (text: string) =>
      JSON.stringify({ message: { role: 'user', content: text }, cwd: workDir }) + '\n';
    const contentA = line('aaaa');
    const contentB = line('bbbb');
    expect(contentA.length).toBe(contentB.length);

    await fs.writeFile(p, contentA);
    const stat1 = await fs.stat(p);
    const meta1 = await scanFileMeta(p, stat1);
    expect(meta1.firstPrompt).toBe('aaaa');

    // 文件内容已变，但传入相同的 (mtimeMs, size) → 命中缓存返回旧值
    await fs.writeFile(p, contentB);
    const meta2 = await scanFileMeta(p, stat1);
    expect(meta2.firstPrompt).toBe('aaaa');

    // size 变化 → 缓存失效，拿到新值
    const stat2 = { ...stat1, size: stat1.size + 1 } as typeof stat1;
    const meta3 = await scanFileMeta(p, stat2);
    expect(meta3.firstPrompt).toBe('bbbb');

    // mtime 变化 → 缓存同样失效
    const stat3 = { ...stat1, mtimeMs: stat1.mtimeMs + 1000 } as typeof stat1;
    const meta4 = await scanFileMeta(p, stat3);
    expect(meta4.firstPrompt).toBe('bbbb');

    // 清缓存后按原 stat 也重新读盘
    clearFileMetaCache();
    const meta5 = await scanFileMeta(p, stat1);
    expect(meta5.firstPrompt).toBe('bbbb');
  });
});
