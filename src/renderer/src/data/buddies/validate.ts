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
 * 自定义 ASCII → 渲染帧：合法时返回剔除首尾空行的行数组（单帧，直接覆盖基座渲染，
 * 不做眼睛/帽子替换）；内容为空或非法时返回 null，调用方回退到基座。
 * 只剔除头部/尾部的空行，保留中部空行以维持构图。
 */
export function applyCustomAscii(ascii: string): string[] | null {
  const r = validateCustomAscii(ascii)
  if (!r.ok) return null
  const lines = r.lines.slice()
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.length ? lines : null
}
