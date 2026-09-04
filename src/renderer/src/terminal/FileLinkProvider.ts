import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { OpenTerminalPath } from '../composables/useElectron'

// 路径段字符：字母数字、下划线、点、~、+、-（不含冒号/引号/括号等）
const SEG = '[\\w.~+-]+'

/**
 * 匹配本地文件路径候选（不含 http/https，后者由 WebLinksAddon 处理）：
 *  - Windows 盘符绝对路径   C:\a\b  或  C:/a/b
 *  - POSIX 绝对路径        /usr/local/bin
 *  - home 简写            ~/.zshrc、~user/foo
 *  - 相对路径（至少两段）    src/main/app.ts、./x/y、../z
 * 约束：
 *  - 相对路径要求含 `/` 分隔且前缀不是 :/ —— 避免吞掉 URL 的 host/path 部分
 *  - POSIX 绝对路径前置不是字面字符/点/斜杠，避免吞 `//`（URL 双斜杠）
 * 命中只是候选：是否真是文件由主进程 fs.stat 兜底，不存在则点击无反应
 */
const FILE_PATH_RE = new RegExp(
  '[A-Za-z]:[\\\\/]' + SEG + '(?:[\\\\/]' + SEG + ')*'
  + '|(?<![\\w./])/' + SEG + '(?:/' + SEG + ')*'
  + '|~[\\w.~+-]*/' + SEG + '(?:/' + SEG + ')*'
  + '|(?<![\\w.:/~])' + SEG + '/' + SEG + '(?:/' + SEG + ')*'
)

/** 剥掉正则可能误吞的尾标点（真实路径结尾不会出现这些字符） */
function sanitizeTail(text: string): string {
  return text.replace(/[.,;:'"!?)\]}>-]+$/, '')
}

export class FileLinkProvider implements ILinkProvider {
  constructor(
    private readonly _terminal: Terminal,
    private readonly _workdir: string,
    /** workdir 内文件被点击时回调（渲染层在「文件」编辑器打开该 relPath） */
    private readonly _onOpenWorkdirFile: (relPath: string) => void,
  ) {}

  public provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    callback(computeFileLinks(this._terminal, y, this._workdir, this._onOpenWorkdirFile))
  }
}

/**
 * 点击路径候选后的统一动作：让主进程 resolve + stat，再按结果分派。
 * workdir 内文件（kind=workdir-file）走编辑器回调；目录/外部文件主进程已系统打开，
 * 直接忽略；不存在（kind=none）静默无反应。IPC 失败也不影响终端交互。
 */
async function activatePathLink(
  workdir: string,
  rawPath: string,
  onOpenWorkdirFile: (relPath: string) => void,
): Promise<void> {
  try {
    const result = await OpenTerminalPath(workdir, rawPath)
    if (result?.kind === 'workdir-file' && result.relPath) {
      onOpenWorkdirFile(result.relPath)
    }
  } catch {
    // 静默：路径点击失败不应打断终端使用
  }
}

function computeFileLinks(
  terminal: Terminal,
  y: number,
  workdir: string,
  onOpenWorkdirFile: (relPath: string) => void,
): ILink[] {
  const rex = new RegExp(FILE_PATH_RE.source, 'g')
  const [lines, startLineIndex] = getWindowedLineStrings(y - 1, terminal)
  const joined = lines.join('')

  const result: ILink[] = []
  let match: RegExpExecArray | null
  while ((match = rex.exec(joined))) {
    const text = sanitizeTail(match[0])
    if (!text) continue

    const [startY, startX] = mapStringIndex(terminal, startLineIndex, 0, match.index)
    const [endY, endX] = mapStringIndex(terminal, startY, startX, text.length)
    if (startY === -1 || startX === -1 || endY === -1 || endX === -1) continue

    result.push({
      range: {
        start: { x: startX + 1, y: startY + 1 },
        end: { x: endX, y: endY + 1 },
      },
      text,
      activate: (_event, uri) => {
        void activatePathLink(workdir, uri, onOpenWorkdirFile)
      },
    })
  }
  return result
}

/**
 * 取当前行及其 wrap 出来的上下行，拼成一段连续字符串再匹配。
 * 与 @xterm/addon-web-links 的 LinkComputer 同一策略：向上/下扩展直到空白或超过 2048。
 */
function getWindowedLineStrings(lineIndex: number, terminal: Terminal): [string[], number] {
  let line: IBufferLine | undefined
  let topIdx = lineIndex
  let bottomIdx = lineIndex
  let length = 0
  let content = ''
  const lines: string[] = []

  if ((line = terminal.buffer.active.getLine(lineIndex))) {
    const currentContent = line.translateToString(true)

    if (line.isWrapped && currentContent[0] !== ' ') {
      length = 0
      while ((line = terminal.buffer.active.getLine(--topIdx)) && length < 2048) {
        content = line.translateToString(true)
        length += content.length
        lines.push(content)
        if (!line.isWrapped || content.includes(' ')) break
      }
      lines.reverse()
    }

    lines.push(currentContent)

    length = 0
    while ((line = terminal.buffer.active.getLine(++bottomIdx)) && line.isWrapped && length < 2048) {
      content = line.translateToString(true)
      length += content.length
      lines.push(content)
      if (content.includes(' ')) break
    }
  }
  return [lines, topIdx]
}

/**
 * 把拼接串里的字符串下标映射回 buffer 位置（0-based），返回 [lineIndex, columnIndex]，
 * 越界返回 [-1, -1]。处理宽字符（CJK 宽度 2）与 wrap 边界宽字符偏差。
 */
function mapStringIndex(
  terminal: Terminal,
  lineIndex: number,
  rowIndex: number,
  stringIndex: number,
): [number, number] {
  const buf = terminal.buffer.active
  const cell = buf.getNullCell()
  let start = rowIndex
  while (stringIndex) {
    const line = buf.getLine(lineIndex)
    if (!line) return [-1, -1]
    for (let i = start; i < line.length; ++i) {
      line.getCell(i, cell)
      const chars = cell.getChars()
      const width = cell.getWidth()
      if (width) {
        stringIndex -= chars.length || 1
        // wrap 边界宽字符修正（与 addon 一致）
        if (i === line.length - 1 && chars === '') {
          const next = buf.getLine(lineIndex + 1)
          if (next && next.isWrapped) {
            next.getCell(0, cell)
            if (cell.getWidth() === 2) stringIndex += 1
          }
        }
      }
      if (stringIndex < 0) return [lineIndex, i]
    }
    lineIndex++
    start = 0
  }
  return [lineIndex, start]
}
