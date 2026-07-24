// src/main/terminal-screenshot.ts

import fs from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import xtermHeadless from '@xterm/headless';
const { Terminal } = xtermHeadless as any;

// ── CJK font registration ──────────────────────────────────────────

function registerCJKFont(): void {
  const candidates = [
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\msgothic.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansMonoCJKsc-VF.otf',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, 'CJK Mono'); return; }
  }
}
registerCJKFont();

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_FONT_FAMILY =
  '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", "CJK Mono", monospace';

const DEFAULT_BG = '#1e1e1e';
const DEFAULT_FG = '#d4d4d4';

// xterm default 16-color palette (indices 0-15)
const PALETTE_16: Record<number, string> = {
  0: '#000000', 1: '#aa0000', 2: '#00aa00', 3: '#aa5500',
  4: '#0000aa', 5: '#aa00aa', 6: '#00aaaa', 7: '#aaaaaa',
  8: '#555555', 9: '#ff5555', 10: '#55ff55', 11: '#ffff55',
  12: '#5555ff', 13: '#ff55ff', 14: '#55ffff', 15: '#ffffff',
};

// ── Types ──────────────────────────────────────────────────────────

interface RenderOptions {
  fontSize?: number;
  fontFamily?: string;
  padding?: number;
  lineHeight?: number;
  cols?: number;
  rows?: number;
}

// ── Color conversion ───────────────────────────────────────────────

// 调暗 RGB/调色板颜色：用于 dim 单元 (\x1b[2m) 在白底上增强可读性
// 白色背景下，原色按 factor 调暗，避免淡色文字看不见
function darkenColor(css: string, factor: number): string {
  const m = css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) {
    const r = Math.round(parseInt(m[1], 16) * factor);
    const g = Math.round(parseInt(m[2], 16) * factor);
    const b = Math.round(parseInt(m[3], 16) * factor);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  const rgb = css.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (rgb) {
    return `rgb(${Math.round(+rgb[1] * factor)},${Math.round(+rgb[2] * factor)},${Math.round(+rgb[3] * factor)})`;
  }
  return css;
}

// ColorMode: 0 = default, 1 = palette (0-255), 2 = RGB (0xRRGGBB)
function cellFgToCSS(cell: any): string {
  const mode = cell.getFgColorMode();
  let css: string;
  if (mode === 0) css = DEFAULT_FG;
  else if (mode === 2) css = `#${cell.getFgColor().toString(16).padStart(6, '0')}`;
  else {
    // palette
    const c = cell.getFgColor();
    if (c < 16) css = PALETTE_16[c] ?? DEFAULT_FG;
    else if (c < 232) {
      // 216-color cube: 6x6x6, index 16-231
      const i = c - 16;
      const r = Math.floor(i / 36) * 51;
      const g = Math.floor((i % 36) / 6) * 51;
      const b = (i % 6) * 51;
      css = `rgb(${r},${g},${b})`;
    } else {
      // grayscale 232-255
      const g = (c - 232) * 10 + 8;
      css = `rgb(${g},${g},${g})`;
    }
  }
  return css;
}

function cellBgToCSS(cell: any): string {
  const mode = cell.getBgColorMode();
  if (mode === 0) return DEFAULT_BG;
  if (mode === 2) return `#${cell.getBgColor().toString(16).padStart(6, '0')}`;
  const c = cell.getBgColor();
  if (c < 16) return PALETTE_16[c] ?? DEFAULT_BG;
  if (c < 232) {
    const i = c - 16;
    const r = Math.floor(i / 36) * 51;
    const g = Math.floor((i % 36) / 6) * 51;
    const b = (i % 6) * 51;
    return `rgb(${r},${g},${b})`;
  }
  const g = (c - 232) * 10 + 8;
  return `rgb(${g},${g},${g})`;
}

// ── Headless rendering ─────────────────────────────────────────────

export async function renderBufferToPng(
  rawBuffer: string,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const fontSize = opts.fontSize ?? 14;
  const fontFamily = opts.fontFamily ?? DEFAULT_FONT_FAMILY;
  const padding = opts.padding ?? 16;
  const lineHeight = opts.lineHeight ?? Math.round(fontSize * 1.5);
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;

  const term = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
    scrollback: 500,
  });

  // 直接写入原始字节流，由 headless xterm 按 ANSI 语义处理 \r（行首覆盖）、
  // \x1b[2K（擦行）等控制序列。替换 \r 为 \n 会导致重绘场景产生多余行、位置错乱。
  //
  // 前置 \x1b[0m 重置 headless 起始状态到默认，避免 raw buffer 在颜色开启但未 reset 的位置
  // 截断时（如 session.buffer 的 65536 字符硬截断）导致后续内容带着错误颜色渲染。
  await new Promise<void>(resolve => {
    term.write('\x1b[0m' + rawBuffer, resolve);
  });

  const buf = term.buffer.active;
  const totalLines = buf.length;
  const cursorY = buf.baseY + buf.cursorY;

  // 从 cursor 位置向上扫描，找到最后一个有实际内容的行
  let contentEnd = 0;
  for (let y = Math.min(cursorY, totalLines - 1); y >= 0; y--) {
    const line = buf.getLine(y);
    if (line && line.translateToString(true).length > 0) {
      contentEnd = y + 1;
      break;
    }
  }

  if (contentEnd === 0) {
    term.dispose();
    return createEmptyImage(padding);
  }

  const endY = Math.min(totalLines, contentEnd);
  const startY = Math.max(0, endY - 50);

  const font = `${fontSize}px ${fontFamily}`;
  const boldFont = `bold ${font}`;
  const italicFont = `italic ${font}`;
  const boldItalicFont = `bold italic ${font}`;

  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const charWidth = ctx.measureText('W').width;
  const canvasWidth = cols * charWidth + padding * 2;

  const lineCount = endY - startY;
  if (lineCount <= 0) {
    term.dispose();
    return createEmptyImage(padding);
  }

  const canvasHeight = lineCount * lineHeight + padding * 2;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.textBaseline = 'top';

  for (let y = startY; y < endY; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    const yi = y - startY;
    let xPixel = padding;
    const yPixel = padding + yi * lineHeight;

    for (let x = 0; x < cols; x++) {
      const cell = line.getCell(x);
      if (!cell) {
        // 没有 cell：按空格推进 xPixel，保持后续 cell 位置正确
        xPixel += charWidth;
        continue;
      }

      const width = cell.getWidth();
      if (width === 0) {
        // 宽字符第二列：不占独立 cell，跳过
        continue;
      }

      const chars = cell.getChars() || ' ';
      const cellPixelWidth = width * charWidth;

      const bg = cellBgToCSS(cell);
      if (bg !== DEFAULT_BG) {
        ctx.fillStyle = bg;
        ctx.fillRect(xPixel, yPixel, cellPixelWidth, lineHeight);
      }

      if (cell.isBold() && cell.isItalic()) ctx.font = boldItalicFont;
      else if (cell.isBold()) ctx.font = boldFont;
      else if (cell.isItalic()) ctx.font = italicFont;
      else ctx.font = font;

      ctx.fillStyle = cellFgToCSS(cell);

      if (cell.isInvisible()) {
        ctx.fillStyle = DEFAULT_BG;
        ctx.fillRect(xPixel, yPixel, cellPixelWidth, lineHeight);
      } else {
        ctx.fillText(chars, xPixel, yPixel);
        if (cell.isUnderline()) {
          ctx.fillRect(xPixel, yPixel + fontSize + 1, cellPixelWidth, 1);
        }
      }

      xPixel += cellPixelWidth;
    }
  }

  term.dispose();
  return canvas.toBuffer('image/png');
}

// ── Backward-compatible exports ────────────────────────────────────

export function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b[^[\]PX^_0-9]?/g, '')
    .replace(/\r/g, '');
}

export async function renderTextToPng(
  lines: string[],
  opts: RenderOptions = {},
): Promise<Buffer> {
  const raw = lines.join('\n');
  return renderBufferToPng(raw, opts);
}

function createEmptyImage(padding: number): Buffer {
  const cw = padding * 2;
  const canvas = createCanvas(cw, cw);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, 0, cw, cw);
  return canvas.toBuffer('image/png');
}
