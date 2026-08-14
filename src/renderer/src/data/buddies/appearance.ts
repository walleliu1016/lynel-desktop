import type { BuddyEye, BuddyHat } from './types'

/** 眼睛字符选项（参考 EYES 数组） */
export const BUDDY_EYES: BuddyEye[] = ['·', '✦', '×', '◉', '@', '°']

/** 帽子 id 选项（参考 HATS 数组） */
export const BUDDY_HATS: BuddyHat[] = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck']

/** 帽子字符画（参考 HAT_LINES：叠加到基座首行） */
export const HAT_LINES: Record<BuddyHat, string> = {
  none: '',
  crown: ' \\^^^/ ',
  tophat: ' [___] ',
  propeller: '  -+-  ',
  halo: '  ( )  ',
  wizard: '  /^\\  ',
  beanie: ' (___) ',
  tinyduck: '   ,>  ',
}

/** 帽子选择项：label 显示名 + art 字符画预览 */
export const HAT_OPTIONS: { value: BuddyHat; label: string; art: string }[] = [
  { value: 'none', label: '无', art: '' },
  { value: 'crown', label: '皇冠', art: HAT_LINES.crown.trim() },
  { value: 'tophat', label: '礼帽', art: HAT_LINES.tophat.trim() },
  { value: 'propeller', label: '竹蜻蜓', art: HAT_LINES.propeller.trim() },
  { value: 'halo', label: '光环', art: HAT_LINES.halo.trim() },
  { value: 'wizard', label: '巫师帽', art: HAT_LINES.wizard.trim() },
  { value: 'beanie', label: '贝雷帽', art: HAT_LINES.beanie.trim() },
  { value: 'tinyduck', label: '小鸭', art: HAT_LINES.tinyduck.trim() },
]

/**
 * 每物种面部生成器（参考 FACES）：给定眼睛字符返回该物种的脸部字符行。
 * 用于设计区展示当前组合的表情文本；渲染本身只用 BODIES + eye 替换。
 */
export const FACES: Record<string, (eye: string) => string> = {
  duck: (e) => `(${e}>`,
  goose: (e) => `(${e}>`,
  blob: (e) => `(${e}${e})`,
  cat: (e) => `=${e}ω${e}=`,
  dragon: (e) => `<${e}~${e}>`,
  octopus: (e) => `~(${e}${e})~`,
  owl: (e) => `(${e})(${e})`,
  penguin: (e) => `(${e}>)`,
  turtle: (e) => `[${e}_${e}]`,
  snail: (e) => `${e}(@)`,
  ghost: (e) => `/${e}${e}\\`,
  axolotl: (e) => `}${e}.${e}{`,
  capybara: (e) => `(${e}oo${e})`,
  cactus: (e) => `|${e} ${e}|`,
  robot: (e) => `[${e}${e}]`,
  rabbit: (e) => `(${e}..${e})`,
  mushroom: (e) => `|${e} ${e}|`,
  chonk: (e) => `(${e}.${e})`,
}

export function getFace(speciesId: string, eye: string): string {
  const gen = FACES[speciesId]
  return gen ? gen(eye) : ''
}
