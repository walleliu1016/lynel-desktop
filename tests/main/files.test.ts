// tests/main/files.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isIgnored, detectBinary, listDir, resolveEntry, readFileEntry, writeFileEntry, createEntry, renameEntry, deleteEntry, startWatch, stopWatch } from '../../src/main/files.js'
import { getBus } from '../../src/main/events.js'

describe('isIgnored', () => {
  it('忽略常见目录', () => {
    expect(isIgnored('node_modules')).toBe(true)
    expect(isIgnored('.git')).toBe(true)
    expect(isIgnored('dist')).toBe(true)
    expect(isIgnored('__pycache__')).toBe(true)
  })
  it('忽略 *.log / *.lock / *.min.js', () => {
    expect(isIgnored('app.log')).toBe(true)
    expect(isIgnored('package-lock.json')).toBe(true)
    expect(isIgnored('bundle.min.js')).toBe(true)
  })
  it('不忽略普通文件/目录', () => {
    expect(isIgnored('src')).toBe(false)
    expect(isIgnored('main.ts')).toBe(false)
    expect(isIgnored('README.md')).toBe(false)
  })
})

describe('detectBinary', () => {
  it('含 NUL 字节判定二进制', () => {
    expect(detectBinary(Buffer.from([0x68, 0x69, 0x00, 0x0a]))).toBe(true)
  })
  it('纯文本非二进制', () => {
    expect(detectBinary(Buffer.from('hello world\n第二行'))).toBe(false)
  })
})

describe('listDir', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-files-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
  it('目录在前、名称排序、过滤忽略项', () => {
    fs.mkdirSync(path.join(tmp, 'src'))
    fs.mkdirSync(path.join(tmp, 'node_modules'))
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'a')
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{}')
    const entries = listDir(tmp)
    expect(entries.map((e) => e.name)).toEqual(['src', 'a.txt'])
    expect(entries[0].isDir).toBe(true)
  })
})

describe('resolveEntry', () => {
  it('阻止相对路径越界', () => {
    const base = path.join(os.tmpdir(), 'lynel-base')
    fs.mkdirSync(base, { recursive: true })
    expect(() => resolveEntry(base, '../escape.txt')).toThrow(/越界/)
  })
  it('空 relPath 返回 workDir 本身', () => {
    expect(resolveEntry('/tmp/foo', '')).toBe(path.resolve('/tmp/foo'))
  })
})

describe('文件操作', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-files-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('write 后 read 往返一致', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFileEntry(f, '你好 world')
    const r = await readFileEntry(f)
    expect(r.content).toBe('你好 world')
    expect(r.binary).toBe(false)
    expect(r.truncated).toBe(false)
    expect(r.size).toBeGreaterThan(0)
  })

  it('超大文本标记 truncated 且截断', async () => {
    const f = path.join(tmp, 'big.txt')
    await fs.promises.writeFile(f, 'x'.repeat(1024 * 1024 + 10))
    const r = await readFileEntry(f)
    expect(r.truncated).toBe(true)
    expect(r.binary).toBe(false)
    expect(r.content.length).toBeLessThan(1024 * 1024 + 10)
  })

  it('二进制文件标记 binary', async () => {
    const f = path.join(tmp, 'bin.dat')
    await fs.promises.writeFile(f, Buffer.from([0x01, 0x02, 0x00, 0x03]))
    const r = await readFileEntry(f)
    expect(r.binary).toBe(true)
  })

  it('create 文件/目录，rename 改名', async () => {
    await createEntry(path.join(tmp, 'f.ts'), false)
    expect(fs.existsSync(path.join(tmp, 'f.ts'))).toBe(true)
    await createEntry(path.join(tmp, 'd'), true)
    expect(fs.statSync(path.join(tmp, 'd')).isDirectory()).toBe(true)
    await renameEntry(tmp, 'f.ts', 'g.ts')
    expect(fs.existsSync(path.join(tmp, 'g.ts'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'f.ts'))).toBe(false)
  })

  it('delete 文件与目录（递归）', async () => {
    const f = path.join(tmp, 'x.ts')
    await writeFileEntry(f, 'x')
    await deleteEntry(f)
    expect(fs.existsSync(f)).toBe(false)
    const d = path.join(tmp, 'dir')
    fs.mkdirSync(path.join(d, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(d, 'sub', 'a.js'), 'a')
    await deleteEntry(d)
    expect(fs.existsSync(d)).toBe(false)
  })
})

describe('file watcher', () => {
  let tmp: string
  let events: Array<{ workDir: string; relPath: string }>

  // getBus 是进程级单例，事件在 afterEach 移除监听，避免跨用例串扰
  function handler(ev: { workDir: string; relPath: string }): void {
    events.push(ev)
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-watch-'))
    events = []
    getBus().on('file:changed', handler)
  })

  afterEach(async () => {
    getBus().off('file:changed', handler)
    await stopWatch(tmp)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // 等 chokidar 完成初始化，避免写入落在初始扫描窗口内被 ignoreInitial 吞掉
  async function waitReady(): Promise<void> {
    await new Promise((r) => setTimeout(r, 500))
  }

  // 等待目标事件出现；覆盖 150ms 合帧延迟 + chokidar 抖动，timeout 放宽避免 flaky
  async function waitEvent(relPath: string): Promise<{ workDir: string; relPath: string }> {
    return vi.waitFor(() => {
      const hit = events.find((e) => e.workDir === tmp && e.relPath === relPath)
      if (!hit) throw new Error('未收到 file:changed 事件')
      return hit
    }, { timeout: 3000 })
  }

  it('修改文件触发 file:changed，relPath 用正斜杠', async () => {
    const f = path.join(tmp, 'a.txt')
    fs.writeFileSync(f, 'v1')
    startWatch(tmp)
    await waitReady()
    fs.writeFileSync(f, 'v2')
    const ev = await waitEvent('a.txt')
    expect(ev.workDir).toBe(tmp)
    expect(ev.relPath).toBe('a.txt')
  })

  it('忽略 node_modules 内的文件写入', async () => {
    const nm = path.join(tmp, 'node_modules')
    fs.mkdirSync(nm, { recursive: true })
    startWatch(tmp)
    await waitReady()
    // 先写一个普通文件确认 watcher 已生效
    fs.writeFileSync(path.join(tmp, 'keep.txt'), 'a')
    await waitEvent('keep.txt')
    // 向忽略目录写文件，不应产生任何 file:changed 事件
    fs.writeFileSync(path.join(nm, 'dep.js'), 'x')
    await new Promise((r) => setTimeout(r, 600))
    expect(events.some((e) => e.workDir === tmp && e.relPath.startsWith('node_modules'))).toBe(false)
  })

  it('stopWatch 后不再触发事件', async () => {
    const f = path.join(tmp, 'a.txt')
    fs.writeFileSync(f, 'v1')
    startWatch(tmp)
    await waitReady()
    fs.writeFileSync(f, 'v2')
    await waitEvent('a.txt') // 确认 watcher 已生效
    await stopWatch(tmp)
    const before = events.length
    fs.writeFileSync(f, 'v3')
    await new Promise((r) => setTimeout(r, 600))
    expect(events.length).toBe(before)
  })
})
