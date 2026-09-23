<!-- 设置 → 定时任务。
     与任务面板同级的全局设置，所以放在设置里而不是任务页 —— 任务页管「这个任务怎么跑」，
     这里管「任务子系统整体怎么跑」。

     两个刻意的选择：
     1. **不出现「任务目录」**：所有任务共用一个固定 cwd，那是实现细节不是用户概念。
     2. **通知机器人只做「引用 + 创建入口」**：创建走的是机器人页同一个 BotAddDialog
        （渲染完全一致，不另起一套），选中后把结果显示在这一行。
        本页不维护凭据 —— 那是「机器人」页的事，两处各存一份必然会漂移。 -->
<template>
  <div class="tasks-tab">
    <h2>定时任务</h2>

    <div class="form-group">
      <label class="form-label">并发上限</label>
      <div class="row">
        <button class="step" :disabled="cfg.tasks_max_concurrency <= 1" @click="bump(-1)">
          <Icon name="minus" :size="14" />
        </button>
        <span class="val">{{ cfg.tasks_max_concurrency }}</span>
        <button class="step" :disabled="cfg.tasks_max_concurrency >= 64" @click="bump(1)">
          <Icon name="plus" :size="14" />
        </button>
        <span class="hint">同时最多跑这么多个任务，默认 6</span>
      </div>
    </div>

    <div class="form-group">
      <div class="label-row">
        <label class="form-label">通知机器人</label>
        <span class="chip" :class="{ on: !!boundId }">
          {{ boundId ? '已绑定' : '未绑定 · 不推送' }}
        </span>
      </div>

      <!-- 绑定结果直接显示在这一行：换一个 / 清除都在这儿，不用跳去「机器人」页 -->
      <div class="bot-line">
        <span class="bot-icon"><Icon name="bot" :size="15" /></span>
        <div class="bot-info">
          <div class="bot-name">{{ boundName || '还没有绑定机器人' }}</div>
          <div class="bot-sub" :class="{ bad: boundMissing }">
            {{ boundSub }}
          </div>
        </div>
        <button class="act-btn" @click="openPicker">
          {{ boundId ? '更换' : '选择机器人' }}
        </button>
        <button v-if="boundId" class="act-btn" @click="clear">清除</button>
      </div>

      <p class="hint block">
        所有任务共用这一个出口：跑完把「任务名 / 时间 / 结果」推到它，不需要逐个任务绑定。
        它只用于任务通知 —— 在这里选它<b>不会</b>把任何会话绑到它上面。
      </p>
    </div>

    <!-- 选择已有机器人：只列已添加的，点一条即选中。
         以前这里只有「新建」一个入口，导致绑不到已有机器人、只能不断造新的。 -->
    <div v-if="showPicker" class="picker-mask" @click.self="showPicker = false">
      <div class="picker">
        <div class="picker-hd">
          <h3>选择通知机器人</h3>
          <button class="picker-x" aria-label="关闭" @click="showPicker = false">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <div class="picker-bd">
          <button
            v-for="b in bots.bots"
            :key="b.id"
            class="picker-row"
            :class="{ on: b.id === boundId, denied: !!sessionOf(b.id) }"
            :title="sessionOf(b.id) ? `已绑定会话 ${sessionOf(b.id)}，请先解绑` : ''"
            @click="pick(b.id)"
          >
            <Icon name="bot" :size="14" />
            <span class="picker-name">{{ b.name }}</span>
            <!-- 已绑到某个会话的标出来：那种机器人同时也在给会话转发消息，选之前该知道 -->
            <span v-if="sessionOf(b.id)" class="picker-bound">
              <Icon name="corner-down-left" :size="11" />{{ sessionOf(b.id) }}
            </span>
            <span class="picker-id mono">{{ b.botId }}</span>
            <Icon v-if="b.id === boundId" name="check" :size="13" class="picker-ok" />
          </button>
          <div v-if="bots.bots.length === 0" class="picker-empty">还没有机器人，先新建一个</div>
          <div v-if="pickError" class="picker-error">{{ pickError }}</div>
        </div>
        <div class="picker-note">
          带 <Icon name="corner-down-left" :size="11" /> 的表示它已经绑定了某个会话 ——
          通知机器人与会话绑定互斥，请先解绑再选。
        </div>
        <div class="picker-ft">
          <button class="act-btn" @click="showPicker = false; showCreate = true">
            <Icon name="plus" :size="13" />新建机器人
          </button>
          <span class="sp" />
          <button class="act-btn" @click="showPicker = false">取消</button>
        </div>
      </div>
    </div>

    <!-- 新建走机器人页同一个弹窗（渲染完全一致），保存成功即绑定 -->
    <BotAddDialog v-if="showCreate" @saved="onCreated" @close="showCreate = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../Icon.vue'
import BotAddDialog from '../BotAddDialog.vue'
import { useSettingsStore } from '../../stores/settings'
import { useBotsStore } from '../../stores/bots'
import { useSessionsStore } from '../../stores/sessions'

const settings = useSettingsStore()
const bots = useBotsStore()
const sessions = useSessionsStore()
const cfg = computed(() => settings.cfg as any)

const showCreate = ref(false)
const showPicker = ref(false)
/** 拒选时的提示（选了已绑会话的机器人） */
const pickError = ref('')
/** 机器人列表是否已加载完 —— 没加载完前不能断言「已失效」 */
const botsReady = ref(false)

/** 绑定的机器人：按 id 去机器人列表里找 */
const boundId = computed(() => String(cfg.value.tasks_notify_bot ?? '').trim())
const boundBot = computed(() => bots.bots.find((b) => b.id === boundId.value) ?? null)
/** 绑了 id 但列表里没有（且列表已加载）= 那条已被删，别把 UUID 当名字显示出来骗人 */
const boundMissing = computed(() => !!boundId.value && botsReady.value && !boundBot.value)
const boundName = computed(() => {
  if (!boundId.value) return ''
  if (boundBot.value) return boundBot.value.name
  return boundMissing.value ? '（机器人已删除）' : boundId.value
})
const boundSub = computed(() => {
  if (!boundId.value) return '任务跑完的结果会推给这个机器人'
  if (boundMissing.value) return '这条机器人已经不存在了，请重新选择'
  return `企业微信 · Bot ID ${boundBot.value?.botId || '—'}`
})

onMounted(async () => {
  void settings.load()
  await bots.load()
  // 会话绑定（botId → sessionId）得单独拉一次，选择列表里要标出"这个机器人已绑到哪个会话"
  void sessions.loadBotBindings()
  botsReady.value = true
})

/** 该机器人是否已绑到某个会话（会话绑定存在 recent-sessions 的 botId 里，与任务通知无关）。
 *  这里只是标出来 —— 任务通知走的是另一套数据，选它不会动那个绑定。 */
function sessionOf(botId: string): string {
  return sessions.getBotBoundSessionName(botId) ?? ''
}

function openPicker() {
  pickError.value = ''
  showPicker.value = true
}

function pick(botId: string) {
  // 互斥是双向的：bindSessionBot 拒绑任务通知 bot，这里也拒选已绑会话的 bot ——
  // 否则造出双身份（既转发会话又推任务），BotManagement 的「任务通知」标签还会把真实绑定藏起来
  const boundSession = sessionOf(botId)
  if (boundSession) {
    pickError.value = `「${bots.bots.find((b) => b.id === botId)?.name || botId}」已绑定会话 ${boundSession}，请先解绑再选`
    return
  }
  cfg.value.tasks_notify_bot = botId
  settings.markDirty()
  showPicker.value = false
}

function bump(delta: number) {
  const cur = Number(cfg.value.tasks_max_concurrency) || 6
  cfg.value.tasks_max_concurrency = Math.min(64, Math.max(1, Math.floor(cur) + delta))
  settings.markDirty()
}

/** 弹窗保存成功 → 直接绑上（点「选择机器人」的意图就是"要用它"） */
async function onCreated(botId: string) {
  showCreate.value = false
  await bots.load(true)
  // 主进程返回的那条才是真相：用列表里实际存在的 id，别信弹窗自己生成的那个
  const saved = bots.bots.find((b) => b.id === botId)
  cfg.value.tasks_notify_bot = saved ? saved.id : botId
  settings.markDirty()
}

function clear() {
  cfg.value.tasks_notify_bot = ''
  settings.markDirty()
}
</script>

<style scoped>
.tasks-tab { padding: 20px 24px; max-width: 560px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 20px; }

.form-group { margin-bottom: 22px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.label-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.label-row .chip {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-tertiary);
}
.label-row .chip.on { background: var(--status-success-soft); color: var(--status-success); }

.bot-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}
.bot-icon {
  width: 32px;
  height: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--accent-soft-bg);
  color: var(--accent);
}
.bot-info { flex: 1; min-width: 0; }
.bot-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bot-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.bot-sub.bad { color: var(--status-error); }

.picker-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--scrim);
}
.picker {
  width: 460px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  overflow: hidden;
}
.picker-hd {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.picker-hd h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.picker-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  padding: 4px;
}
.picker-x:hover { color: var(--text-primary); }
.picker-bd { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
.picker-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.picker-row:hover { background: var(--bg-hover); }
.picker-row.on { background: var(--accent-soft-bg); color: var(--accent); }
.picker-name { flex: none; font-weight: 500; color: inherit; }
.picker-id {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-ok { margin-left: auto; flex: none; }
.picker-bound {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-tertiary);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-empty { padding: 24px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
.picker-error {
  padding: 8px 10px;
  margin-top: 4px;
  border-radius: var(--radius-sm);
  background: var(--status-error-soft);
  color: var(--status-error);
  font-size: 11px;
  line-height: 1.6;
}
.picker-row.denied { opacity: .55; cursor: not-allowed; }
.picker-note {
  padding: 10px 18px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.picker-ft {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-primary);
}
.picker-ft .sp { flex: 1; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.row { display: flex; align-items: center; gap: 10px; }
.act-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.act-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.step {
  width: 30px;
  height: 30px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}
.step:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.step:disabled { opacity: .4; cursor: not-allowed; }
.val {
  min-width: 34px;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.hint { font-size: 11px; color: var(--text-tertiary); }
.hint.block { display: block; margin-top: 8px; line-height: 1.65; }
</style>
