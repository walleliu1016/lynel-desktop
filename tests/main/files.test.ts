// tests/main/files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isIgnored, detectBinary, listDir, resolveEntry } from '../../src/main/files.js'

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
