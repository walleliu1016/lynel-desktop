<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import { useGitStore } from '../../stores/git'
import { useFilesStore } from '../../stores/files'
import type { GitFileChange } from '../../composables/useElectron'

const git = useGitStore()
const files = useFilesStore()

const message = ref('')
const committing = ref(false)

interface Group {
  key: 'conflicted' | 'staged' | 'unstaged' | 'untracked'
  label: string
  items: GitFileChange[]
}

const groups = computed<Group[]>(() => {
  const s = git.status
  if (!s) return []
  // 显式标注 all：直接 `[...].filter()` 会让 key 被拓宽为 string，无法满足 Group['key']
  const all: Group[] = [
    { key: 'conflicted', label: '冲突', items: s.conflicted },
    { key: 'staged', label: '暂存的更改', items: s.staged },
    { key: 'unstaged', label: '更改', items: s.unstaged },
    { key: 'untracked', label: '未跟踪', items: s.untracked },
  ]
  return all.filter((g) => g.items.length > 0)
})

const statusLabel: Record<GitFileChange['status'], string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: 'U', '?': 'U',
}

/** 点击变更行 → 在编辑器区打开 diff。未暂存/未跟踪对比 HEAD↔工作区；
 *  已暂存对比 HEAD↔index。
 *
 *  TODO(Task 8)：真正的 `files.openDiff(relPath, rev)` 由 Task 8 添加到 stores/files.ts，
 *  当前尚不存在。为让本任务独立通过 vue-tsc，这里先用本地占位（点击暂无反应）；
 *  Task 8 落地后把函数体换成
 *    files.openDiff(f.path, group === 'staged' ? ':0' : 'HEAD')
 *  并删除下面的 void 语句即可，模板与调用点无需改动。 */
function openDiff(f: GitFileChange, group: Group['key']) {
  void f
  void group
}

function onStage(f: GitFileChange) {
  void git.stage([f.path])
}

function onUnstage(f: GitFileChange) {
  void git.unstage([f.path])
}

async function onDiscard(f: GitFileChange) {
  // 丢弃不可逆：必须二次确认，且文案列出具体文件
  const label = f.status === '?' ? `删除未跟踪文件「${f.path}」` : `放弃「${f.path}」的改动`
  if (!window.confirm(`${label}？此操作不可撤销。`)) return
  await git.discard([f.path])
}

async function onCommit() {
  // 与提交按钮的 :disabled 保持一致：Ctrl+Enter 会绕过按钮 disabled，
  // 若此处不拦 hasStaged，空暂存区提交失败后会把输入框清空。
  if (committing.value || !git.hasStaged || !message.value.trim()) return
  committing.value = true
  try {
    await git.commit(message.value)
    // 只有提交成功（暂存区被清空）才清空输入框
    if (!git.hasStaged) message.value = ''
  } finally {
    committing.value = false
  }
}
</script>

<template>
  <div class="git-panel">
    <!-- 顶部状态条：分支 + ahead/behind + 远程操作 -->
    <div class="git-bar">
      <Icon name="git-branch" :size="13" />
      <span class="branch" :title="git.status?.tracking ?? ''">
        {{ git.status?.branch ?? '—' }}
      </span>
      <span v-if="(git.status?.ahead ?? 0) > 0" class="ahead">↑{{ git.status?.ahead }}</span>
      <span v-if="(git.status?.behind ?? 0) > 0" class="behind">↓{{ git.status?.behind }}</span>
      <span class="bar-spacer" />
      <button class="bar-btn" title="fetch" :disabled="!!git.busyOp" @click="git.runRemoteOp('fetch')">
        <Icon name="refresh-cw" :size="13" />
      </button>
      <button class="bar-btn" title="pull" :disabled="!!git.busyOp" @click="git.runRemoteOp('pull')">
        <Icon name="arrow-down" :size="13" />
      </button>
      <button class="bar-btn" title="push" :disabled="!!git.busyOp" @click="git.runRemoteOp('push')">
        <Icon name="arrow-up" :size="13" />
      </button>
    </div>

    <!-- 变更列表 -->
    <div class="change-list">
      <!-- 首次加载：status 还是 null，不能据此判定「不是仓库」 -->
      <div v-if="git.loading && !git.status" class="empty">加载中…</div>
      <!-- store 的 error 契约要求「把错误显示在面板里」（见 stores/git.ts refresh） -->
      <div v-else-if="git.error" class="empty error" :title="git.error">{{ git.error }}</div>
      <div v-else-if="!git.status?.isRepo" class="empty">当前目录不是 Git 仓库</div>
      <div v-else-if="git.totalChanges === 0" class="empty">工作区干净，没有待提交的变更</div>
      <template v-else>
        <div v-for="g in groups" :key="g.key" class="group">
          <div class="group-title">{{ g.label }} ({{ g.items.length }})</div>
          <div
            v-for="f in g.items"
            :key="g.key + ':' + f.path"
            class="row"
            :title="f.path"
            @click="openDiff(f, g.key)"
          >
            <span class="st" :class="'st-' + g.key">{{ statusLabel[f.status] }}</span>
            <span class="path">{{ f.path }}</span>
            <span class="row-actions">
              <button
                v-if="g.key === 'staged'"
                class="mini"
                title="取消暂存"
                @click.stop="onUnstage(f)"
              >
                <Icon name="minus" :size="12" />
              </button>
              <button v-else class="mini" title="暂存" @click.stop="onStage(f)">
                <Icon name="plus" :size="12" />
              </button>
              <button class="mini danger" title="丢弃改动" @click.stop="onDiscard(f)">
                <Icon name="undo-2" :size="12" />
              </button>
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 提交表单 -->
    <div class="commit-bar">
      <textarea
        v-model="message"
        class="msg"
        rows="1"
        placeholder="提交说明（Ctrl+Enter 提交）"
        @keydown.ctrl.enter.prevent="onCommit"
      />
      <button
        class="commit-btn"
        :disabled="!git.hasStaged || !message.trim() || committing || !!git.busyOp"
        @click="onCommit"
      >
        <Icon name="check" :size="13" /> 提交
      </button>
    </div>
  </div>
</template>

<style scoped>
.git-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.git-bar {
  height: 30px;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.branch { color: var(--text-primary); }
.ahead { color: var(--status-ok); }
.behind { color: var(--status-warn); }
.bar-spacer { flex: 1; }
.bar-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.bar-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
.bar-btn:disabled { opacity: 0.4; cursor: default; }
.change-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.empty {
  padding: 16px;
  text-align: center;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.empty.error { color: var(--status-error); }
.group-title {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  font-size: var(--fs-caption);
  color: var(--text-primary);
  cursor: pointer;
}
.row:hover { background: var(--code-hover); }
.st {
  width: 12px;
  flex-shrink: 0;
  font-weight: 600;
  text-align: center;
}
.st-conflicted { color: var(--status-error); }
.st-staged { color: var(--status-ok); }
.st-unstaged { color: var(--status-warn); }
.st-untracked { color: var(--text-tertiary); }
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.row-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.row:hover .row-actions { display: inline-flex; }
.mini {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.mini:hover { background: var(--bg-hover); color: var(--text-primary); }
.mini.danger:hover { color: var(--status-error); }
.commit-bar {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
}
.msg {
  flex: 1;
  min-width: 0;
  max-height: 80px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--fs-caption);
  resize: vertical;
}
.msg:focus { outline: none; border-color: var(--border-focus); }
.commit-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--text-inverse);
  font-size: var(--fs-caption);
  cursor: pointer;
}
.commit-btn:disabled { opacity: 0.4; cursor: default; }
</style>
