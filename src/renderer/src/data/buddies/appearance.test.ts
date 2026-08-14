// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BUDDY_EYES, BUDDY_HATS, HAT_LINES, HAT_OPTIONS, getFace } from './appearance'

describe('appearance', () => {
  it('内置 6 种眼睛字符', () => {
    expect(BUDDY_EYES).toEqual(['·', '✦', '×', '◉', '@', '°'])
  })

  it('内置 8 种帽子（含 none）', () => {
    expect(BUDDY_HATS).toHaveLength(8)
    expect(BUDDY_HATS[0]).toBe('none')
  })

  it('none 帽子字符画为空', () => {
    expect(HAT_LINES.none).toBe('')
  })

  it('HAT_OPTIONS 覆盖全部帽子且 label 非空', () => {
    expect(HAT_OPTIONS).toHaveLength(8)
    for (const h of HAT_OPTIONS) {
      expect(h.label).toBeTruthy()
      expect(BUDDY_HATS).toContain(h.value)
    }
  })

  it('getFace 按物种与眼睛生成面部', () => {
    expect(getFace('duck', '·')).toBe('(·>')
    expect(getFace('cat', '×')).toBe('=×ω×=')
  })

  it('未知物种 getFace 返回空串', () => {
    expect(getFace('__none__', '·')).toBe('')
  })
})
