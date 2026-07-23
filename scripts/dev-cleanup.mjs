#!/usr/bin/env node
/**
 * dev-cleanup：杀掉所有 lynel-desktop 开发环境遗留进程。
 *
 * 背景：`npm run dev` 用 concurrently 起 vite + tsc + electron，
 * TaskStop / Ctrl+C 只能杀 concurrently 父进程，spawn 出的子进程
 * 在 Windows 上被 reparent 到 init，持有 5173 端口和单例锁，
 * 导致下次启动失败。用 taskkill /F /T 沿进程树根杀，一次性清理。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const here = path.dirname(fileURLToPath(import.meta.url))
const isWin = process.platform === 'win32'

try {
  if (isWin) {
    execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'dev-cleanup.ps1')],
      { stdio: 'inherit' },
    )
  } else {
    execFileSync('pkill', ['-f', 'lynel-desktop|vite/bin/vite|tsc --watch|concurrently.*npm run dev'], { stdio: 'inherit' })
  }
} catch {
  // 没找到进程 / 退出码非 0 都正常
  console.log('[dev-cleanup] done')
}
