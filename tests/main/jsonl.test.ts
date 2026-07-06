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
    await fs.writeFile(p, JSON.stringify({ cwd: workDir }) + '\n');
    const list = await scanAll();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sess-1');
    expect(list[0].workDir).toBe(workDir);
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
});
