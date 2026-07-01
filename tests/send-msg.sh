#!/usr/bin/env bash
# 向 Ease UI 的指定 session 发送消息
# 用法: ./tests/send-msg.sh <sessionId> <msg>
# 需要设置环境变量 EASE_HOOK_PORT（在设置页底部查看，例如 Hook :63251）

set -euo pipefail

SESSION_ID="${1:-}"
MSG="${2:-}"
EASE_HOOK_PORT=52164

if [ -z "$SESSION_ID" ] || [ -z "$MSG" ]; then
  echo "用法: $0 <sessionId> <msg>" >&2
  echo "示例: $0 550e8400-e29b-41d4-a716-446655440000 '你好'" >&2
  exit 1
fi


# 简单转义双引号，避免 JSON 格式错误
ESCAPED_MSG="${MSG//\"/\\\"}"
JSON=$(printf '{"session_id":"%s","prompt":"%s"}' "$SESSION_ID" "$ESCAPED_MSG")

curl -s -X POST "http://127.0.0.1:${EASE_HOOK_PORT}/api/send" \
  -H "Content-Type: application/json" \
  -d "$JSON"

echo
