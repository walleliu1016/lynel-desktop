// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { validateCustomAscii, applyCustomAscii, MAX_ASCII_LINES, MAX_ASCII_WIDTH } from './validate'

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

describe('applyCustomAscii', () => {
  it('空内容返回 null', () => {
    expect(applyCustomAscii('')).toBeNull()
    expect(applyCustomAscii('   \n  ')).toBeNull()
  })

  it('非法内容返回 null', () => {
    const tooMany = Array.from({ length: MAX_ASCII_LINES + 1 }, () => 'x').join('\n')
    expect(applyCustomAscii(tooMany)).toBeNull()
  })

  it('合法内容返回行数组', () => {
    expect(applyCustomAscii('A\nB')).toEqual(['A', 'B'])
  })

  it('剔除首尾空行，保留中部空行', () => {
    expect(applyCustomAscii('\nA\n\nB\n')).toEqual(['A', '', 'B'])
  })

  it('仅空白行返回 null', () => {
    expect(applyCustomAscii('\n \n')).toBeNull()
  })
})
