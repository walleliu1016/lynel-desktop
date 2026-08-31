<template>
  <div class="bot-management">
    <div class="header-row">
      <h2>机器人管理</h2>
    </div>

    <!-- 性能警告 -->
    <div v-if="store.overThreshold" class="warning-banner">
      <Icon name="warning" :size="14" />
      <span>已配置 {{ store.count }} 个机器人（阈值 {{ store.threshold }}），过多可能影响机器性能</span>
    </div>

    <!-- 阈值设置 -->
    <div class="form-group">
      <label class="form-label">机器人数量阈值</label>
      <div class="threshold-row">
        <input
          class="form-input threshold-input"
          type="number"
          :value="store.threshold"
          min="1"
          max="50"
          @change="onThresholdChange"
        />
        <span class="form-hint">Bot 太多会影响机器性能</span>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="store.loading" class="loading-state">
      <div class="skeleton-row" v-for="i in 3" :key="i" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="store.bots.length === 0" class="empty-state">
      <p>暂无机器人配置</p>
    </div>

    <!-- Bot 列表 -->
    <div v-else class="bot-table-wrap">
      <div class="bot-table">
        <div class="bot-thead">
          <span class="col-status" />
          <span class="col-name">名称</span>
          <span class="col-source">来源</span>
          <span class="col-botid">Bot ID</span>
          <span class="col-bound">绑定会话</span>
          <span class="col-actions">操作</span>
        </div>
        <div
          v-for="bot in store.bots"
          :key="bot.id"
          class="bot-tr"
          :class="{ editing: editingId === bot.id }"
        >
          <!-- 摘要行 -->
          <div class="bot-summary" @click="toggleEdit(bot.id)">
            <span class="col-status">
              <span class="status-dot" :class="bot.connected ? 'online' : 'offline'" :title="bot.connected ? '已连接' : '未连接'" />
            </span>
            <span class="col-name bot-name">{{ bot.name }}</span>
            <span class="col-source">
              <span class="source-tag">{{ SOURCE_LABELS[bot.source] || '企业微信' }}</span>
            </span>
            <span class="col-botid bot-id-text">{{ bot.botId }}</span>
            <span
              class="col-bound bot-bound"
              @mouseenter="showBoundTip($event, bot.id)"
              @mouseleave="hideBoundTip"
            >
              <template v-if="boundSessionId(bot.id)">
                <Icon name="corner-down-left" :size="11" />
                {{ boundSessionLabel(bot.id) }}
              </template>
              <span v-else class="unbound">未绑定</span>
            </span>
            <span class="col-actions">
              <button class="btn-icon" title="编辑" @click.stop="toggleEdit(bot.id)">
                <Icon name="pencil" :size="13" />
              </button>
              <button v-if="boundSessionId(bot.id)" class="btn-icon" title="解绑" @click.stop="onUnbind(bot.id)">
                <Icon name="link-2-off" :size="13" />
              </button>
              <button class="btn-icon btn-icon--danger" title="删除" @click.stop="onDelete(bot.id)">
                <Icon name="trash" :size="13" />
              </button>
            </span>
          </div>

          <!-- 编辑表单 -->
          <div v-if="editingId === bot.id" class="bot-edit-form">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">名称</label>
                <input class="form-input" v-model="editForm.name" placeholder="如：我的助手" />
              </div>
              <div class="form-group">
                <label class="form-label">来源</label>
                <select class="form-input" v-model="editForm.source">
                  <option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Bot ID</label>
                <input class="form-input" v-model="editForm.botId" placeholder="企业微信 bot ID" />
              </div>
              <div class="form-group">
                <label class="form-label">Secret</label>
                <input class="form-input" v-model="editForm.secret" type="password" placeholder="bot secret" />
              </div>
            </div>
            <div class="edit-actions">
              <button class="btn-cancel" @click="cancelEdit">取消</button>
              <button class="btn-save" :disabled="!editValid" @click="onSaveEdit">保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加 Bot：打开统一添加弹窗（扫码创建 / 手动填写） -->
    <button class="add-btn" @click="startAdd">
      <Icon name="plus" :size="14" />
      添加 Bot
    </button>
  </div>

  <!-- 绑定会话 hover tooltip（多行，随单元格定位且不超出窗口） -->
  <Teleport to="body">
    <div
      v-if="boundTip"
      class="bound-tip"
      :style="{ left: boundTip.x + 'px', top: boundTip.y + 'px' }"
      @mouseenter="cancelHideBoundTip"
      @mouseleave="hideBoundTip"
    >
      <div class="bound-tip-head">
        <Icon name="corner-down-left" :size="12" />
        <span class="bound-tip-title">
          {{ boundTip.project }}{{ boundTip.title !== boundTip.project ? ` · ${boundTip.title}` : '' }}
        </span>
      </div>
      <div class="bound-tip-row">
        <span class="bound-tip-label">会话</span>
        <span class="bound-tip-mono">{{ boundTip.sessionId }}</span>
      </div>
    </div>
  </Teleport>

  <BotAddDialog
    v-if="showBotAddDialog"
    @saved="onBotAdded"
    @close="showBotAddDialog = false"
  />

  <ConfirmDialog
    :open="showDeleteDialog"
    title="删除机器人"
    message="确定删除此机器人配置？已绑定的会话会自动解绑。"
    confirm-text="删除"
    :danger="true"
    @confirm="confirmDelete"
    @cancel="showDeleteDialog = false"
  />
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '../Icon.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import BotAddDialog from '../BotAddDialog.vue'
import type { BotItem, BotSource } from '../../types/bots'
import { useBotsStore } from '../../stores/bots'
import { useSessionsStore, sessionDisplayTitle } from '../../stores/sessions'
import { pushToast } from '../../composables/useToast'

const store = useBotsStore()
const sessions = useSessionsStore()

const SOURCE_OPTIONS: { value: BotSource; label: string }[] = [
  { value: 'wecom', label: '企业微信' },
]
const SOURCE_LABELS: Record<BotSource, string> = {
  wecom: '企业微信',
  feishu: '飞书',
}

const editingId = ref<string | null>(null)
const showDeleteDialog = ref(false)
const deleteTargetId = ref<string | null>(null)
const showBotAddDialog = ref(false)
const editForm = reactive({
  name: '',
  source: 'wecom' as BotSource,
  botId: '',
  secret: '',
})

const editValid = computed(() =>
  editForm.name.trim() && editForm.botId.trim() && editForm.secret.trim()
)

/** 查找 bot 绑定的 sessionId */
function boundSessionId(botId: string): string | undefined {
  return sessions.botBindings[botId] || sessions.sessionBots[botId]
}

/** 绑定的 session 展示：`project · title`（不在左侧列表也能查全量索引） */
function boundSessionLabel(botId: string): string {
  const sessionId = boundSessionId(botId)
  if (!sessionId) return ''
  return sessions.getSessionProjectTitle(sessionId)
}

/** 绑定会话详情（供 hover tooltip 展示） */
interface BoundTipInfo {
  x: number
  y: number
  sessionId: string
  project: string
  title: string
}

const boundTip = ref<BoundTipInfo | null>(null)
let boundTipTimer: ReturnType<typeof setTimeout> | null = null

function boundSessionInfo(botId: string): Omit<BoundTipInfo, 'x' | 'y'> | null {
  const sessionId = boundSessionId(botId)
  if (!sessionId) return null
  const meta = sessions.getSessionMeta(sessionId)
  return {
    sessionId,
    project: meta?.project || '',
    title: sessionDisplayTitle(meta),
  }
}

/** 展示绑定会话 tooltip：锚定在单元格旁，右/下越界时翻转，保证不超出窗体 */
function showBoundTip(e: MouseEvent, botId: string) {
  cancelHideBoundTip()
  const info = boundSessionInfo(botId)
  if (!info) return
  const cell = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const tipW = 280
  const tipH = 96
  const W = window.innerWidth
  const H = window.innerHeight
  let x = cell.right + 10
  let y = cell.top
  if (x + tipW > W) x = Math.max(8, cell.left - tipW - 10)
  if (y + tipH > H) y = H - tipH - 8
  if (y < 0) y = 8
  boundTip.value = { x, y, ...info }
}

function cancelHideBoundTip() {
  if (boundTipTimer) { clearTimeout(boundTipTimer); boundTipTimer = null }
}

function hideBoundTip() {
  cancelHideBoundTip()
  boundTipTimer = setTimeout(() => { boundTip.value = null }, 120)
}

async function onUnbind(botId: string) {
  const sessionId = boundSessionId(botId)
  if (!sessionId) return
  try {
    await sessions.bindBot(sessionId, null)
    await sessions.loadBotBindings()
    pushToast({ level: 'info', source: 'bot', message: '已解绑' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'bot', message: '解绑失败：' + (e?.message ?? e) })
  }
}

onMounted(() => {
  void store.load()
  void sessions.loadBotBindings()
  void sessions.loadAllSessions()
})

function toggleEdit(id: string) {
  if (editingId.value === id) {
    editingId.value = null
    return
  }
  const bot = store.bots.find(b => b.id === id)
  if (bot) {
    editForm.name = bot.name
    editForm.source = bot.source || 'wecom'
    editForm.botId = bot.botId
    editForm.secret = bot.secret
    editingId.value = id
  }
}

function cancelEdit() {
  editingId.value = null
}

function startAdd() {
  showBotAddDialog.value = true
}

/** 添加弹窗保存成功：关闭弹窗（store.save 已刷新列表） */
function onBotAdded(_botId: string) {
  showBotAddDialog.value = false
  pushToast({ level: 'info', source: 'bot', message: '已添加机器人' })
}

async function onSaveEdit() {
  if (!editValid.value) return
  try {
    const now = Date.now()
    const bot: BotItem = {
      id: editingId.value!,
      name: editForm.name.trim(),
      source: editForm.source || 'wecom',
      botId: editForm.botId.trim(),
      secret: editForm.secret.trim(),
      chatId: '',
      createdAt: now,
      updatedAt: now,
      connected: false,
    }
    await store.save(bot)
    editingId.value = null
    pushToast({ level: 'info', source: 'bot', message: '保存成功' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'bot', message: '保存失败：' + (e?.message ?? e) })
  }
}

function onDelete(id: string) {
  deleteTargetId.value = id
  showDeleteDialog.value = true
}

async function confirmDelete() {
  const id = deleteTargetId.value
  if (!id) return
  showDeleteDialog.value = false
  deleteTargetId.value = null
  try {
    await store.remove(id)
    if (editingId.value === id) editingId.value = null
    pushToast({ level: 'info', source: 'bot', message: '已删除' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'bot', message: '删除失败：' + (e?.message ?? e) })
  }
}

function onThresholdChange(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(val) && val > 0) {
    void store.setThreshold(val)
  }
}
</script>

<style scoped>
.bot-management { padding: 20px 24px; width: 100%; }

.header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin: 0; }

.warning-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; margin-bottom: 16px;
  background: var(--status-warn-bg);
  border: 1px solid var(--status-warn-border);
  border-radius: var(--radius-md);
  color: var(--status-warn);
  font-size: 12px;
}

.form-group { margin-bottom: 14px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

.threshold-row { display: flex; align-items: center; gap: 10px; }
.threshold-input { width: 80px; }

.loading-state { display: flex; flex-direction: column; gap: 8px; }
.skeleton-row {
  height: 44px; border-radius: var(--radius-md);
  background: var(--bg-input); opacity: 0.5;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.2; } }

.empty-state { text-align: center; padding: 40px 0; color: var(--text-tertiary); font-size: 13px; }

.bot-table-wrap { margin-bottom: 12px; }
.bot-table { display: flex; flex-direction: column; gap: 2px; }

.bot-thead {
  display: flex; align-items: center;
  padding: 6px 12px;
  font-size: 10px; color: var(--text-tertiary); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.3px;
}

.bot-tr {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.bot-tr.editing { border-color: var(--accent); }

.bot-summary {
  display: flex; align-items: center;
  min-height: 42px; padding: 6px 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.bot-summary:hover { background: var(--bg-hover); }

.col-status { width: 24px; flex-shrink: 0; display: flex; align-items: center; }
.col-name { width: 110px; flex-shrink: 0; }
.col-source { width: 70px; flex-shrink: 0; }
.col-botid { flex: 1; min-width: 0; }
.col-bound { width: 160px; flex-shrink: 0; }
.col-actions { width: 90px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; }

.status-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}
.status-dot.online { background: var(--status-success); }
.status-dot.offline { background: var(--text-tertiary); }

.bot-name { font-size: 13px; color: var(--text-primary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.source-tag {
  font-size: 9px; color: var(--accent); background: var(--accent-soft-bg);
  padding: 1px 6px; border-radius: 4px; white-space: nowrap;
}
.bot-id-text { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bot-bound {
  font-size: 11px; color: var(--text-secondary);
  display: inline-flex; align-items: center; gap: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bot-bound .unbound { color: var(--text-tertiary); }

.btn-icon {
  display: flex; align-items: center; padding: 4px 6px;
  border: none; background: none; color: var(--text-tertiary);
  border-radius: var(--radius-sm); cursor: pointer;
}
.btn-icon:hover { background: var(--bg-input); color: var(--text-primary); }
.btn-icon--danger:hover { color: var(--status-error); }

.form-row { display: flex; gap: 16px; }
.form-row .form-group { flex: 1; }

.bot-edit-form {
  padding: 12px 14px 4px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; margin-bottom: 8px; }

.btn-save { padding: 7px 20px; background: var(--accent); color: var(--text-inverse); border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover { background: var(--border); }

.add-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 10px 14px;
  border: 1px dashed var(--border); background: none;
  border-radius: var(--radius-md); color: var(--text-tertiary);
  font-size: 13px; cursor: pointer; justify-content: center;
}
.add-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft-bg); }

.bound-tip {
  position: fixed;
  z-index: 2000;
  width: 280px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-window);
  padding: 10px 12px;
  box-sizing: border-box;
}
.bound-tip-head {
  display: flex; align-items: flex-start; gap: 6px;
  color: var(--text-primary);
  font-size: 12px; font-weight: 500;
  line-height: 1.5;
  margin-bottom: 8px;
}
.bound-tip-head :deep(svg) { color: var(--accent); flex-shrink: 0; margin-top: 1px; }
.bound-tip-title { word-break: break-all; }
.bound-tip-row {
  display: flex; align-items: baseline; gap: 8px;
  color: var(--text-secondary); font-size: 11px;
}
.bound-tip-label { flex-shrink: 0; color: var(--text-tertiary); font-size: 10px; }
.bound-tip-mono {
  font-family: var(--font-mono);
  color: var(--text-primary);
  word-break: break-all;
}
</style>
