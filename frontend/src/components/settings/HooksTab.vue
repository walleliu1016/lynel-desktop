<template>
  <div class="hooks-tab">
    <div class="header">
      <h2>Hook 配置</h2>
      <span class="path">~/.claude/settings.json</span>
    </div>

    <div class="toolbar">
      <div class="view-toggle">
        <button :class="{ active: view === 'form' }" @click="view = 'form'">表单</button>
        <button :class="{ active: view === 'json' }" @click="view = 'json'">JSON</button>
      </div>
      <div class="toolbar-actions">
        <button class="btn-secondary" @click="onReload" :disabled="loading">重新加载</button>
        <button class="btn-primary" @click="onSave" :disabled="!dirty || loading">保存</button>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <!-- JSON 视图 -->
    <div v-else-if="view === 'json'" class="json-view">
      <textarea
        v-model="rawJSON"
        class="json-editor"
        spellcheck="false"
        @input="onJSONChange"
      />
      <div v-if="jsonError" class="json-error">{{ jsonError }}</div>
    </div>

    <!-- 表单视图 -->
    <div v-else class="form-view">
      <div v-for="ev in hookTypes" :key="ev.name" class="hook-section">
        <div class="hook-section-head" @click="toggleExpand(ev.name)">
          <span class="expand-icon">
            <Icon :name="expanded[ev.name] ? 'chevron-down' : 'chevron-right'" :size="12" />
          </span>
          <span class="hook-name">{{ ev.name }}</span>
          <span class="hook-timeout">{{ ev.timeout }}s 超时</span>
          <span class="hook-count">{{ hookCount(ev.name) }} 条</span>
        </div>
        <div v-if="expanded[ev.name]" class="hook-section-body">
          <div v-if="!hookEntries(ev.name).length" class="empty">无配置</div>
          <div v-for="(matcher, mi) in hookEntries(ev.name)" :key="mi" class="matcher-block">
            <div class="matcher-head">
              <input
                v-model="matcher.matcher"
                class="matcher-input"
                placeholder="matcher（留空匹配所有）"
                @input="markDirty"
              />
              <button class="btn-icon del" @click="removeMatcher(ev.name, mi)" title="删除">
                <Icon name="trash" :size="12" />
              </button>
            </div>
            <div v-for="(hook, hi) in matcher.hooks" :key="hi" class="hook-item">
              <select v-model="hook.type" class="hook-type" @change="markDirty">
                <option value="command">command</option>
                <option value="http">http</option>
              </select>
              <template v-if="hook.type === 'command'">
                <input v-model="hook.command" class="hook-value mono" placeholder="shell 命令" @input="markDirty" />
              </template>
              <template v-else>
                <input v-model="hook.url" class="hook-value mono" placeholder="http://..." @input="markDirty" />
              </template>
              <input v-model.number="hook.timeout" class="hook-timeout-input" type="number" min="1" max="600" @input="markDirty" title="超时秒数" />
              <button class="btn-icon del" @click="removeHook(ev.name, mi, hi)" title="删除">
                <Icon name="trash" :size="12" />
              </button>
            </div>
            <button class="add-hook" @click="addHook(ev.name, mi)">
              <Icon name="plus" :size="11" /> 添加 hook
            </button>
          </div>
          <button class="add-matcher" @click="addMatcher(ev.name)">
            <Icon name="plus" :size="11" /> 添加 matcher
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { GetHooksConfig, SaveHooksConfig } from '../../composables/useWails'

// 完整的 Claude hook 类型列表
const hookTypes = [
  { name: 'SessionStart', timeout: 5 },
  { name: 'SessionEnd', timeout: 5 },
  { name: 'PreToolUse', timeout: 5 },
  { name: 'PostToolUse', timeout: 5 },
  { name: 'PostToolUseFailure', timeout: 5 },
  { name: 'Notification', timeout: 120 },
  { name: 'PermissionRequest', timeout: 300 },
  { name: 'Stop', timeout: 5 },
  { name: 'UserPromptSubmit', timeout: 5 },
  { name: 'PreCompact', timeout: 5 },
  { name: 'PostCompact', timeout: 5 },
  { name: 'SubagentStart', timeout: 5 },
  { name: 'SubagentStop', timeout: 5 },
]

interface HookItem { type: string; command?: string; url?: string; timeout?: number }
interface MatcherEntry { matcher: string; hooks: HookItem[] }
type HooksData = Record<string, MatcherEntry[]>

const view = ref<'form' | 'json'>('form')
const loading = ref(false)
const error = ref('')
const jsonError = ref('')
const dirty = ref(false)
const expanded = reactive<Record<string, boolean>>({})

// 原始 hooks 数据
let hooksData: HooksData = {}
const rawJSON = ref('')

function initExpanded() {
  for (const ev of hookTypes) {
    if (!(ev.name in expanded)) expanded[ev.name] = true
  }
}

function hookEntries(name: string): MatcherEntry[] {
  return hooksData[name] || []
}

function hookCount(name: string): number {
  const matchers = hooksData[name] || []
  return matchers.reduce((sum, m) => sum + (m.hooks?.length || 0), 0)
}

function markDirty() { dirty.value = true }
function toggleExpand(name: string) { expanded[name] = !expanded[name] }

// JSON 视图 ↔ 数据同步
function dataToJSON(): string {
  return JSON.stringify(hooksData, null, 2)
}

function onJSONChange() {
  dirty.value = true
  try {
    const parsed = JSON.parse(rawJSON.value)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      jsonError.value = '必须是 JSON 对象'
      return
    }
    hooksData = parsed as HooksData
    jsonError.value = ''
  } catch (e: any) {
    jsonError.value = e.message
  }
}

function addMatcher(event: string) {
  if (!hooksData[event]) hooksData[event] = []
  hooksData[event].push({ matcher: '', hooks: [] })
  expanded[event] = true
  markDirty()
}

function removeMatcher(event: string, mi: number) {
  hooksData[event].splice(mi, 1)
  if (!hooksData[event].length) delete hooksData[event]
  markDirty()
}

function addHook(event: string, mi: number) {
  hooksData[event][mi].hooks.push({ type: 'command', command: '', timeout: 5 })
  markDirty()
}

function removeHook(event: string, mi: number, hi: number) {
  hooksData[event][mi].hooks.splice(hi, 1)
  markDirty()
}

async function onReload() {
  await loadHooks()
}

async function loadHooks() {
  loading.value = true
  error.value = ''
  try {
    const raw = await GetHooksConfig()
    if (raw && typeof raw === 'object') {
      hooksData = JSON.parse(JSON.stringify(raw))
    } else {
      hooksData = {}
    }
    rawJSON.value = dataToJSON()
    dirty.value = false
    initExpanded()
  } catch (e: any) {
    error.value = '加载失败：' + (e?.message ?? e)
    hooksData = {}
  } finally {
    loading.value = false
  }
}

async function onSave() {
  if (jsonError.value) return
  rawJSON.value = dataToJSON()
  loading.value = true
  try {
    await SaveHooksConfig(hooksData as any)
    dirty.value = false
  } catch (e: any) {
    error.value = '保存失败：' + (e?.message ?? e)
  } finally {
    loading.value = false
  }
}

onMounted(() => loadHooks())
</script>

<style scoped>
.hooks-tab { padding: 20px 24px; max-width: 800px; height: 100%; display: flex; flex-direction: column; }
.header { margin-bottom: 12px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; }
.path { font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); margin-left: 12px; }

.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.view-toggle { display: flex; background: var(--bg-input); border-radius: var(--radius-md); padding: 2px; }
.view-toggle button {
  padding: 5px 14px; border-radius: var(--radius-sm); font-size: 12px;
  color: var(--text-secondary); border: none; background: none; cursor: pointer;
}
.view-toggle button.active { background: var(--accent); color: white; }
.toolbar-actions { display: flex; gap: 8px; }
.btn-primary { padding: 6px 16px; background: var(--accent); color: white; border: none; border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-primary:hover:not(:disabled) { background: var(--accent-deep); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-secondary { padding: 6px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-secondary:hover:not(:disabled) { background: var(--border); }

.loading, .error { padding: 20px; text-align: center; font-size: 13px; }
.error { color: var(--status-error); }

/* JSON 视图 */
.json-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.json-editor {
  flex: 1; min-height: 400px; width: 100%;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 14px;
  color: var(--text-primary); font-size: 13px; font-family: var(--font-mono);
  line-height: 1.6; resize: none; outline: none; tab-size: 2;
}
.json-editor:focus { border-color: var(--accent); }
.json-error { color: var(--status-error); font-size: 12px; margin-top: 6px; font-family: var(--font-mono); }

/* 表单视图 */
.form-view { flex: 1; overflow-y: auto; min-height: 0; }
.hook-section { margin-bottom: 6px; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.hook-section-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: var(--bg-panel); cursor: pointer; user-select: none;
}
.hook-section-head:hover { background: var(--bg-input); }
.expand-icon { color: var(--text-tertiary); font-size: 10px; width: 14px; flex-shrink: 0; }
.hook-name { font-size: 12px; color: var(--accent-light); font-weight: 600; font-family: var(--font-mono); }
.hook-timeout { font-size: 10px; color: var(--text-tertiary); }
.hook-count { font-size: 10px; color: var(--text-tertiary); margin-left: auto; }
.hook-section-body { padding: 8px 12px 12px; background: var(--bg-primary); }
.empty { color: var(--text-tertiary); font-size: 11px; padding: 8px 0; }

.matcher-block { margin-bottom: 10px; padding: 8px 10px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.matcher-head { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.matcher-input { flex: 1; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 8px; color: var(--text-secondary); font-size: 11px; font-family: inherit; }
.matcher-input:focus { outline: none; border-color: var(--accent); }
.matcher-input::placeholder { color: var(--text-tertiary); }

.hook-item { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.hook-type { width: 90px; flex-shrink: 0; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 6px; color: var(--text-primary); font-size: 11px; font-family: inherit; }
.hook-value { flex: 1; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 8px; color: var(--text-primary); font-size: 11px; font-family: inherit; }
.hook-value:focus, .hook-type:focus { outline: none; border-color: var(--accent); }
.mono { font-family: var(--font-mono); }
.hook-timeout-input { width: 50px; flex-shrink: 0; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 4px; color: var(--text-primary); font-size: 11px; text-align: center; }
.hook-timeout-input:focus { outline: none; border-color: var(--accent); }

.btn-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-tertiary); border-radius: var(--radius-sm); cursor: pointer; flex-shrink: 0; }
.btn-icon:hover { background: var(--status-error); color: white; }

.add-hook, .add-matcher {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; padding: 4px 10px; border-radius: var(--radius-sm); cursor: pointer;
  color: var(--text-secondary); background: none; border: 1px dashed var(--border);
}
.add-hook:hover, .add-matcher:hover { border-color: var(--accent); color: var(--accent-light); }
.add-hook { margin-top: 4px; }
.add-matcher { margin-top: 2px; }
</style>
