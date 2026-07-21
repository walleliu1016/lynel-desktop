<template>
  <div class="flow-pane">
    <div v-if="tools.length" class="toolmenu">
      <details class="fold">
        <summary>
          <span class="more show">{{ tools.length }} tools offered to the model</span>
          <span class="more hide">hide tools</span>
        </summary>
        <pre>{{ tools.map((t) => t.name).join('\n') }}</pre>
      </details>
    </div>
    <div v-if="!steps.length" class="empty">暂无步骤</div>
    <div v-else class="timeline">
      <div
        v-for="(s, i) in steps"
        :key="i"
        :class="stepClass(s)"
        :style="stepStyle(s)"
      >
        <Icon :name="iconNameFor(s)" :size="14" class="dot" />
        <div class="node">
          <div class="lead">
            <span v-if="s.kind === 'tool_use'">tool_use &rarr; <b>{{ s.name }}</b></span>
            <span v-else-if="s.kind === 'skill'">Skill &rarr; <b>{{ s.name }}</b></span>
            <span v-else-if="s.kind === 'tool_result'">tool_result &hookleftarrow; executed locally</span>
            <span v-else-if="s.kind === 'stop'">stop_reason: {{ s.text }}</span>
            <span v-else-if="s.kind === 'thinking'">thinking</span>
            <span v-else>{{ s.kind }}</span>
            <span class="tags">
              <span v-if="s.kind === 'skill'" class="tag skill">skill</span>
              <span v-if="s.kind === 'tool_result'" :class="['tag', s.isError ? 'err' : 'result']">
                {{ s.isError ? 'error' : 'ok' }}
              </span>
              <span v-if="s.callId" class="tag id" :style="{ background: hueBg(s.callId), color: hueFg(s.callId) }">
                {{ String(s.callId).slice(-6) }}
              </span>
              <span v-if="s.latest" class="tag latest">this turn</span>
            </span>
          </div>
          <details v-if="s.text && s.kind !== 'stop'" class="step-body">
            <summary><span class="prev">{{ oneLine(s.text) }}</span></summary>
            <pre>{{ s.text }}</pre>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../../Icon.vue'
import { idHue, hueBg, hueFg } from '../../../composables/useIdHue'

const props = defineProps<{ detail: any }>()

interface ToolItem { name: string }
const tools = computed<ToolItem[]>(() => {
  const list = props.detail?.request?.body?.tools || []
  return list.map((t: Record<string, unknown>) => ({ name: t.name as string }))
})

function stepClass(s: any) {
  const cls = ['step', s.kind]
  if (s.kind === 'tool_use' || s.kind === 'skill' || s.kind === 'tool_result') cls.push('indent')
  return cls
}

function stepStyle(s: any) {
  if (!s.callId) return undefined
  return { '--hue': String(idHue(s.callId)) }
}

const ICON_MAP: Record<string, string> = {
  user: 'user', assistant: 'bot', thinking: 'sparkles',
  tool_use: 'wrench', skill: 'puzzle', tool_result: 'corner-down-left', stop: 'square',
}

function iconNameFor(s: any): string {
  return ICON_MAP[s.kind] || 'help'
}

function oneLine(t: string, n = 100): string {
  const s = (t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '\u2026' : s
}

function skillName(text: string): string {
  try { const o = JSON.parse(text); return o.skill || o.name || '' } catch { return '' }
}

const steps = computed(() => {
  const out: any[] = []
  const body = props.detail?.request?.body || {}
  const parsed = props.detail?.reassembled

  for (const m of body.messages || []) {
    const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]
    for (const b of content) {
      if (b.type === 'tool_use') {
        const isSkill = b.name === 'Skill'
        out.push({
          kind: isSkill ? 'skill' : 'tool_use',
          name: isSkill ? skillName(JSON.stringify(b.input ?? {})) || 'skill' : b.name,
          callId: b.id || null,
          text: JSON.stringify(b.input ?? {}, null, 2),
        })
      } else if (b.type === 'tool_result') {
        out.push({
          kind: 'tool_result',
          callId: b.tool_use_id || null,
          isError: !!b.is_error,
          text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2),
        })
      } else if (b.type === 'thinking') {
        out.push({ kind: 'thinking', text: b.thinking ?? '' })
      } else {
        out.push({ kind: m.role === 'assistant' ? 'assistant' : 'user', text: b.text ?? '' })
      }
    }
  }

  if (parsed && Array.isArray(parsed.content)) {
    for (const b of parsed.content) {
      if (b.type === 'tool_use') {
        const isSkill = b.name === 'Skill'
        out.push({
          kind: isSkill ? 'skill' : 'tool_use',
          name: isSkill ? (b.input?.skill || 'skill') : b.name,
          callId: b.id || null,
          text: JSON.stringify(b.input ?? {}, null, 2),
          latest: true,
        })
      } else if (b.type === 'thinking') {
        out.push({ kind: 'thinking', text: b.thinking ?? '', latest: true })
      } else {
        out.push({ kind: 'assistant', text: b.text ?? '', latest: true })
      }
    }
    if (parsed.stop_reason) {
      out.push({ kind: 'stop', text: parsed.stop_reason })
    }
  }

  return out
})
</script>

<style scoped>
.flow-pane { padding: 12px; overflow: auto; }
.toolmenu { margin-bottom: 12px; }

details.fold > summary {
  cursor: pointer; padding: 6px 12px; color: var(--text-secondary);
  font-size: 12px;
}
details.fold > summary .more { color: var(--accent); }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary .hide { display: none; }
details.fold[open] > summary .show { display: none; }
details.fold[open] > summary .hide { display: inline; }
details.fold pre {
  padding: 8px 12px; margin: 0; font-size: 12px;
  white-space: pre-wrap; color: var(--text-secondary);
  background: var(--bg-input);
}

.timeline { position: relative; padding: 4px 0; }
.timeline::before {
  content: ""; position: absolute; left: 16px; top: 8px; bottom: 8px;
  width: 2px; background: var(--border);
}
.step { position: relative; display: flex; gap: 12px; padding: 5px 0 5px 34px; }
.step.indent { padding-left: 58px; }
.step .dot {
  position: absolute; left: 7px; top: 5px; width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
}
.step.indent .dot { left: 32px; }
.step.user .dot { color: var(--status-warn); }
.step.assistant .dot { color: var(--accent); }
.step.stop .dot { color: var(--text-tertiary); }
.step.thinking .dot { color: var(--text-secondary); }

.step .node { flex: 1; min-width: 0; }
.step .lead {
  font-size: 12.5px;
  font-family: var(--font-mono);
}
.step .lead b { color: var(--accent); }

.step.tool_use, .step.skill, .step.tool_result {
  border-left: 2px solid hsl(var(--hue, 210) 60% 48%);
  background: hsl(var(--hue, 210) 60% 48% / 0.08);
  border-radius: 0 6px 6px 0; margin-left: -2px;
}
.step.tool_use .dot, .step.skill .dot, .step.tool_result .dot {
  color: hsl(var(--hue, 210) 70% 66%);
}

.tags { display: inline-flex; gap: 4px; align-items: center; margin-left: 6px; }
.tag {
  padding: 1px 6px; border-radius: 8px; font-size: 10px;
  font-family: var(--font-mono);
}
.tag.result { background: var(--status-success); color: var(--bg-primary); }
.tag.err { background: var(--status-error); color: var(--text-inverse); }
.tag.skill { background: #b48ead; color: var(--bg-primary); }
.tag.latest { background: var(--accent); color: var(--text-inverse); }
.tag.id { letter-spacing: .3px; }

.step-body { margin: 2px 0 0; }
.step-body > summary { cursor: pointer; padding: 0; color: var(--text-tertiary); transition: color 120ms; }
.step-body > summary:hover { color: var(--text-secondary); }
.step-body > summary::-webkit-details-marker { display: none; }
.step-body > summary .prev { color: var(--text-tertiary); font-size: 12px; font-family: var(--font-mono); }
.step-body > pre {
  margin: 4px 0 0; padding: 8px 10px; background: var(--bg-input);
  border-radius: 6px; max-height: 320px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
  font-family: var(--font-mono);
  font-size: 12px;
}

.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
