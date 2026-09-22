// 单编辑器实例的「单闸门」不变量守卫。
//
// 全应用同一时刻只允许一个 CodeEditor 实例：它用 `file:///${relPath}` 建 Monaco model，
// 而 Monaco 对同一 URI 只允许一个 model，第二个实例会直接抛
// `Cannot add model because it already exists!`。互斥完全靠 HomeView 里**同一个** computed
// `hostInSplit`：分屏右栏用它 v-if 挂载，「文件」子页的 CodeView 用它做 :editor-in-split。
//
// 这条断言**刻意**做成源码级文本匹配 —— 脆弱是设计的一部分：把右栏改成 v-show、或另写
// 一个条件，类型检查与现有组件测试都不会报错（VTU 各自挂载组件，看不见两个宿主共存），
// 而这几行恰恰是那个改动必然要碰的地方 —— 在这里当场失败，好过运行时白屏。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 刻意不用 `new URL('./HomeView.vue', import.meta.url)`：Vite 会把这个字面量模式当成
// 资源 URL 引用改写掉（改成一个非 file 协议的 URL），readFileSync 收到就报
// 「The URL must be of scheme file」。
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'HomeView.vue'), 'utf8')

describe('HomeView 分屏单闸门不变量', () => {
  it('分屏右栏与 CodeView 由同一个 hostInSplit 互斥', () => {
    // 右栏必须用 v-if 挂载：换成 v-show 后，终端子页被隐藏时右栏仍然在世，
    // 就会与 CodeView 里的 CodeEditor 并存 → Monaco URI 冲突。
    expect(
      src.includes('v-if="hostInSplit"'),
      '分屏右栏的挂载条件必须是 v-if="hostInSplit"（v-show 会让它与 CodeView 的 CodeEditor 同时在世）',
    ).toBe(true)
    expect(
      src.includes(':editor-in-split="hostInSplit"'),
      'CodeView 必须传 :editor-in-split="hostInSplit"，否则编辑器会在两个宿主里各渲染一次',
    ).toBe(true)
    // 闸门只能有一个定义：复制成两份（如给右栏单独算一个）就不再互斥
    const defs = src.match(/const\s+hostInSplit\b/g) ?? []
    expect(defs.length, `hostInSplit 必须恰好定义一次，实际匹配到 ${defs.length} 次`).toBe(1)
  })
})
