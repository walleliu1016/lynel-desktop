import re

with open('src/main/channels/wecom-channel.ts', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

# 1. Remove command methods (handleCommand through handleToCommand)
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    if re.search(r'^\s+private async handleCommand\(', line):
        start_idx = i
    if start_idx is not None and re.search(r'^\s+private async sendWeComReply\(', line):
        end_idx = i
        break

if start_idx and end_idx:
    while start_idx > 0 and lines[start_idx-1].strip() == '':
        start_idx -= 1
    # Also remove trailing blank line
    while end_idx < len(lines) and lines[end_idx].strip() == '':
        end_idx += 1
    del lines[start_idx:end_idx]
    print(f'Removed lines {start_idx+1}-{end_idx} (command methods)')

# 2. Remove getSessionCmdArg
for i, line in enumerate(lines):
    if re.search(r'private getSessionCmdArg\(', line):
        j = i
        # Find end of method (next method or property)
        while j < len(lines):
            if j != i and re.search(r'^\s+private (async )?\w+\(', lines[j]):
                break
            j += 1
        j -= 1  # back to last line of method
        # Remove blank lines before
        while i > 0 and lines[i-1].strip() == '':
            i -= 1
        # Remove trailing blank lines
        while j+1 < len(lines) and lines[j+1].strip() == '':
            j += 1
        del lines[i:j+1]
        print(f'Removed getSessionCmdArg')
        break

# 3-6. Do string replacements on the joined content
content2 = '\n'.join(lines)

# 3. Update formatPermissionRequest signature
content2 = content2.replace(
    'private formatPermissionRequest(header: string, toolName: string, input: unknown, reqId: string | number): string {',
    'private formatPermissionRequest(header: string, toolName: string, input: unknown): string {',
)
content2 = content2.replace(
    'return `${header}\n\n**权限请求：${toolName}**${inputBlock}\n\n操作：`/allow ${reqId}` 或 `/deny ${reqId}`;',
    'return `${header}\n\n**权限请求：${toolName}**${inputBlock}`;',
)

# 4. Update formatAskUserQuestion signature
content2 = content2.replace(
    'private formatAskUserQuestion(header: string, input: unknown, reqId: string | number): string {',
    'private formatAskUserQuestion(header: string, input: unknown): string {',
)

# Fix the empty questions case
content2 = content2.replace(
    'return `${header}\n\n**Claude 向你提问**\n\n操作：`/answer ${reqId} <你的回答>`;',
    'return `${header}\n\n**Claude 向你提问**`;',
)

# Remove the /answer examples section
old_examples = (
    "\n    lines.push('**回复示例：**');\n"
    + "    lines.push(`- \\`/answer ${reqId} 1\\`  单选`);\n"
    + "    lines.push(`- \\`/answer ${reqId} 1,2\\`  多选`);\n"
    + "    lines.push(`- \\`/answer ${reqId} 自定义回答\\`  自由输入`);\n"
    + "    if (questions.length > 1) {\n"
    + "      lines.push(`- \\`/answer ${reqId} 1;2,3\\`  多个问题用分号分隔`);\n"
    + "    }\n"
)
content2 = content2.replace(old_examples, '\n')

# 5. Update callers - formatPermissionRequest calls
content2 = content2.replace(
    '\n        this.formatPermissionRequest(\n        this.formatHeader(event, msgSeq),\n        p.toolName || \'unknown\',\n        p.toolInput,\n        this.getSessionCmdArg(event.sessionId),\n      )',
    '\n        this.formatPermissionRequest(\n        this.formatHeader(event, msgSeq),\n        p.toolName || \'unknown\',\n        p.toolInput,\n      )',
)

# Update formatAskUserQuestion callers
content2 = content2.replace(
    '\n        this.formatAskUserQuestion(\n        this.formatHeader(event, msgSeq),\n        input,\n        this.getSessionCmdArg(event.sessionId),\n      )',
    '\n        this.formatAskUserQuestion(\n        this.formatHeader(event, msgSeq),\n        input,\n      )',
)

# 6. Clean up triple blank lines
while '\n\n\n' in content2:
    content2 = content2.replace('\n\n\n', '\n\n')

with open('src/main/channels/wecom-channel.ts', 'w', encoding='utf-8') as f:
    f.write(content2)

print('Done - all commands removed')
