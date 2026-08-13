// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { validateCustomAscii, MAX_ASCII_LINES, MAX_ASCII_WIDTH } from './validate'

describe('validateCustomAscii', () => {
  it('空内容报错', () => {
    expect(validateCustomAscii('').ok).toBe(false)
    expect(validateCustomAscii('   \n  ').ok).toBe(false)
  })

  it('超行数报错', () => {
    const tooMany = Array.from({ length: MAX_ASCII_LINES + 1 }, () => 'xx').join('\n')
    expect(validateCustomAscii(tooMany).ok).toBe(false)
  })

  it('行宽超限报错', () => {
    const tooWide = 'x'.repeat(MAX_ASCII_WIDTH + 1)
    expect(validateCustomAscii(tooWide).ok).toBe(false)
  })

  it('合法输入通过并返回逐行数组', () => {
    const input = ' /\\_/\\ \n( o.o )'
    const r = validateCustomAscii(input)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lines).toEqual([' /\\_/\\ ', '( o.o )'])
    }
  })
})
