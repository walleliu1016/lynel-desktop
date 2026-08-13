import type { BuddyRole } from './types'

export const MAX_ASCII_LINES = 40
export const MAX_ASCII_WIDTH = 80

export type ValidateResult = { ok: true; lines: string[] } | { ok: false; error: string }

/** 校验自定义 ASCII：非空、限行数、限单行宽度。返回逐行数组供渲染。 */
export function validateCustomAscii(input: string): ValidateResult {
  // 仅去掉 \r；trim 只用于判断非空，避免破坏 ASCII 构图所需的前导/尾随空格
  const normalized = input.replace(/\r/g, '')
  if (!normalized.trim()) return { ok: false, error: '内容为空' }
  const lines = normalized.split('\n')
  if (lines.length > MAX_ASCII_LINES) {
    return { ok: false, error: `行数超过上限 ${MAX_ASCII_LINES} 行` }
  }
  for (const line of lines) {
    if (line.length > MAX_ASCII_WIDTH) {
      return { ok: false, error: `单行宽度超过上限 ${MAX_ASCII_WIDTH} 字符` }
    }
  }
  return { ok: true, lines }
}

/**
 * 自定义 ASCII 覆盖角色画：粘贴内容合法时，把 idle/thinking/celebration/alarm
 * 四组帧都替换为自定义图案（单帧，退化为通用浮动）；内容为空或非法时原样返回角色。
 * 首尾空行剔除：粘贴时首/尾换行会在 lines 里留下空行，渲染会多出空行；
 * 这里只剔除头部/尾部的空行，保留中部空行以维持构图。
 */
export function applyCustomAscii(role: BuddyRole, ascii: string): BuddyRole {
  const r = validateCustomAscii(ascii)
  if (!r.ok) return role
  const lines = r.lines.slice()
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  if (!lines.length) return role
  return {
    ...role,
    frames: {
      ...role.frames,
      idle: lines,
      thinking: lines,
      celebration: lines,
      alarm: lines,
    },
  }
}
