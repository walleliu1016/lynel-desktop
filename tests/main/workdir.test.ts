import { describe, it, expect } from 'vitest'
import os from 'node:os'
import { normalizeWorkdir } from '../../src/main/workdir'

describe('normalizeWorkdir', () => {
  it('空白/空串回退到用户主目录', () => {
    expect(normalizeWorkdir('')).toBe(os.homedir())
    expect(normalizeWorkdir('   ')).toBe(os.homedir())
    expect(normalizeWorkdir(undefined)).toBe(os.homedir())
  })
  it('非空目录原样返回并去除首尾空白', () => {
    expect(normalizeWorkdir('/tmp/foo')).toBe('/tmp/foo')
    expect(normalizeWorkdir('  C:\\Work\\Project  ')).toBe('C:\\Work\\Project')
  })
})
