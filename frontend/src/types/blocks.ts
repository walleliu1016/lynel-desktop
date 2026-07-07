// 与 Go 端 internal/jsonl/parser.go 的 contentBlock 字段对应。
// Claude CLI stream-json 输出的 message.content 可能是字符串或 content block 数组;
// 数组里的元素 type 取值: text / thinking / tool_use / tool_result / image。
//
// Lynel Desktop 渲染层只关心这些结构化类型;未知类型(例如 AskUserQuestion 早期的 server_tool_use
// 变体、EnterPlanMode 等)走 tool_use 通用分支 + JSON fallback。

export type ToolResultBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }

export type AskOption = {
  label: string
  description?: string
  preview?: string
}

export type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | {
      type: 'tool_use'
      id?: string
      name: string
      input: Record<string, unknown>
    }
  | {
      type: 'tool_result'
      toolUseId?: string
      content: ToolResultBlock[]
      isError: boolean
    }

// Wails GetSessionMessages 返回的 m.content 可能是:
//   - string (Go 的 json.RawMessage 序列化成的 JSON 字符串)
//   - object/array (已 parse 的结构)
//   - undefined (空内容)
export type RawContent = string | unknown[] | object | undefined | null

// 工具调用的输入 input 字段在 Go 端是 json.RawMessage,前端拿到的是已 parse 的对象。
// 极少数情况下(legacy jsonl)还是字符串,这里做一次宽松的归一化。
export function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (input == null) return {}
  if (typeof input === 'string') {
    try {
      const v = JSON.parse(input)
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  if (typeof input === 'object') return input as Record<string, unknown>
  return {}
}
