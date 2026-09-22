<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import { useGitStore } from '../../stores/git'
import { useFilesStore } from '../../stores/files'
import type { GitBranchInfo, GitFileChange, GitStashEntry } from '../../composables/useElectron'
import { formatRelTime } from '../../utils/time'
import { useResizablePanel } from '../../composables/useResizablePanel'

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
 *  已暂存对比 HEAD↔index。 */
function openDiff(f: GitFileChange, group: Group['key']) {
  const staged = group === 'staged'
  files.openDiff(f.path, 'HEAD', staged ? ':0' : 'WORKTREE', staged ? '暂存区' : '工作区')
}

/** 点历史展开列表里的文件 → 打开「该提交 ↔ 它的第一父」的 diff。
 *  用 `<hash>^` 作为左端：根提交没有父，左侧取不到内容会被归零为空，
 *  正好呈现出「整个文件都是新增」的效果。 */
function onOpenCommitFile(relPath: string) {
  const c = git.commitDetail
  if (!c) return
  files.openDiff(relPath, `${c.hash}^`, c.hash, c.shortHash)
}

/** 把当前分支重置到某个提交。三种模式的波及面逐级放大，确认文案要如实写清楚 ——
 *  hard 会连工作区一起丢，是这里唯一不可逆的操作。 */
async function onReset(c: { hash: string; shortHash: string }, mode: 'soft' | 'mixed' | 'hard') {
  const detail = {
    soft: '只移动 HEAD，索引与工作区保持不变。',
    mixed: '移动 HEAD 并重置索引，改动保留为未暂存。',
    hard: '移动 HEAD，并丢弃索引与工作区的全部改动。',
  }[mode]
  const extra = mode === 'hard' ? '\n\n硬重置会永久丢弃未提交的改动，且无法恢复。' : ''
  if (!window.confirm(`将当前分支重置到 ${c.shortHash}？\n\n${detail}${extra}`)) return
  await git.resetTo(c.hash, mode)
}

// ---------- 左右分栏宽度（localStorage 持久化，200–640px） ----------
const { width: changesWidth, dragging, onResizeStart } = useResizablePanel({
  storageKey: 'lynel:git-changes-width',
  defaultWidth: 320,
  min: 200,
  max: 640,
  handle: 'right',
})

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

// ---------- 分支下拉 ----------
// 下拉挂在 body 上（Teleport）：左栏有 overflow:hidden，留在原地会被裁掉
const branchOpen = ref(false)
const newBranch = ref('')
const ddPos = ref({ top: '0px', left: '0px' })

function openBranchMenu(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  ddPos.value = { top: `${r.bottom + 2}px`, left: `${r.left}px` }
  branchOpen.value = true
}

async function onCheckout(b: GitBranchInfo) {
  branchOpen.value = false
  if (b.current) return
  await git.checkoutBranch(b.name)
}

async function onCreateBranch() {
  const name = newBranch.value.trim()
  if (!name) return
  branchOpen.value = false
  newBranch.value = ''
  await git.createBranch(name)
}

async function onDeleteBranch(b: GitBranchInfo) {
  // 删除分支不可逆，且 -d 只对已合并分支生效（未合并会由主进程报错回来）
  if (!window.confirm(`删除分支「${b.name}」？已合并才会成功。`)) return
  await git.deleteBranch(b.name)
}

// ---------- stash ----------
const stashOpen = ref(false)

/** stash 的展示文案：没写说明时退回 `stash@{N}`。
 *  放成函数而不是写在模板插值里 —— `{{ x || `stash@{${n}}` }}` 这种嵌套反引号
 *  会让 Vue 模板解析器直接报错，函数体内写就没事。 */
function stashLabel(s: GitStashEntry): string {
  return s.message || `stash@{${s.index}}`
}

function stashTitle(s: GitStashEntry): string {
  return `${stashLabel(s)}\n${s.branch} · ${formatRelTime(s.date)}`
}

async function onStash() {
  const msg = window.prompt('暂存说明（可留空）')
  if (msg === null) return // 取消
  await git.stashChanges(msg.trim() || undefined)
}

async function onPopStash(index: number) {
  await git.popStash(index)
}

async function onDropStash(index: number) {
  if (!window.confirm(`丢弃 stash@{${index}}？丢弃后无法恢复。`)) return
  await git.dropStash(index)
}
</script>

<template>
  <div class="git-panel">
    <!-- 左栏：分支条 + 变更列表 + 提交表单。宽度可拖，见 changesWidth -->
    <div class="col-changes" :style="{ width: changesWidth + 'px' }">
      <!-- 顶部状态条：分支（可点开切换）+ ahead/behind + stash/远程操作 -->
      <div class="git-bar">
        <button class="branch-btn" :title="git.status?.tracking ?? '切换分支'" @click="openBranchMenu">
          <Icon name="git-branch" :size="13" />
          <span class="branch">{{ git.status?.branch ?? '—' }}</span>
          <Icon name="chevron-down" :size="11" />
        </button>
        <span v-if="(git.status?.ahead ?? 0) > 0" class="ahead">↑{{ git.status?.ahead }}</span>
        <span v-if="(git.status?.behind ?? 0) > 0" class="behind">↓{{ git.status?.behind }}</span>
        <span class="bar-spacer" />
        <button
          class="bar-btn"
          title="暂存当前改动"
          :disabled="!!git.busyOp || git.totalChanges === 0"
          @click="onStash"
        >
          <Icon name="archive" :size="13" />
        </button>
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

      <!-- stash 区：只在有 stash 时才占位，点标题折叠 -->
      <div v-if="git.stashes.length" class="stash-section">
        <div class="stash-head" @click="stashOpen = !stashOpen">
          <Icon name="chevron-right" :size="12" :class="{ open: stashOpen }" />
          <span>暂存 ({{ git.stashes.length }})</span>
        </div>
        <div v-show="stashOpen" class="stash-list">
          <div
            v-for="s in git.stashes"
            :key="s.index"
            class="stash-row"
            :title="stashTitle(s)"
          >
            <span class="stash-msg">{{ stashLabel(s) }}</span>
            <span class="row-actions">
              <button class="mini" title="取出（pop）" @click.stop="onPopStash(s.index)">
                <Icon name="arrow-down" :size="12" />
              </button>
              <button class="mini danger" title="丢弃（不可恢复）" @click.stop="onDropStash(s.index)">
                <Icon name="trash" :size="12" />
              </button>
            </span>
          </div>
        </div>
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

    <div class="resize-handle" title="拖拽调整宽度" @mousedown.prevent="onResizeStart" />

    <!-- 右栏：提交历史图。graphLine 原样用等宽字体渲染，缩进即分支层级 -->
    <div class="col-log">
      <div class="log-head">
        <Icon name="history" :size="12" />
        <span>提交历史</span>
        <span v-if="git.log.length" class="log-count">{{ git.log.length }}</span>
      </div>
      <div class="log-list">
        <div v-if="git.logLoading && !git.log.length" class="empty">加载中…</div>
        <div v-else-if="!git.log.length" class="empty">暂无提交记录</div>
        <template v-else>
          <div v-for="c in git.log" :key="c.hash" class="log-item">
            <div
              class="log-row"
              :class="{ expanded: git.expandedHash === c.hash }"
              :title="`${c.hash}（点击查看该提交的改动）`"
              @click="git.toggleCommitDetail(c.hash)"
            >
              <span class="graph">{{ c.graphLine }}</span>
              <span class="log-body">
                <span class="log-line-1">
                  <span
                    v-for="r in c.refs"
                    :key="r.type + ':' + r.name"
                    class="ref"
                    :class="'ref-' + r.type"
                  >{{ r.name }}</span>
                  <span class="log-msg">{{ c.message }}</span>
                </span>
                <span class="log-meta">{{ c.author }} · {{ formatRelTime(c.date) }} · {{ c.shortHash }}</span>
              </span>
            </div>
            <!-- 展开：重置操作 + 该提交改动的文件；点文件名打开「它 ↔ 第一父」的 diff -->
            <div v-if="git.expandedHash === c.hash" class="commit-detail">
              <div class="commit-actions">
                <span class="ca-label">重置到此处</span>
                <button class="ca-btn" title="只移动 HEAD，索引与工作区不变" @click="onReset(c, 'soft')">
                  软
                </button>
                <button class="ca-btn" title="移动 HEAD 并重置索引，改动退回未暂存" @click="onReset(c, 'mixed')">
                  混合
                </button>
                <button
                  class="ca-btn danger"
                  title="丢弃索引与工作区的全部改动（不可逆）"
                  @click="onReset(c, 'hard')"
                >
                  硬
                </button>
              </div>
              <div class="commit-files">
                <div v-if="git.detailLoading" class="empty">加载中…</div>
                <div v-else-if="!git.commitDetail?.files.length" class="empty">该提交没有文件变更</div>
                <template v-else>
                  <div
                    v-for="f in git.commitDetail.files"
                    :key="f.path"
                    class="commit-file"
                    :title="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path"
                    @click="onOpenCommitFile(f.path)"
                  >
                    <span class="st" :class="'st-cf-' + f.status">{{ statusLabel[f.status] }}</span>
                    <span class="path">{{ f.path }}</span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>

  <!-- 分支下拉：挂到 body 上，避免被左栏的 overflow:hidden 裁掉 -->
  <Teleport to="body">
    <template v-if="branchOpen">
      <div class="dd-backdrop" @click="branchOpen = false" />
      <div class="branch-dd" :style="{ top: ddPos.top, left: ddPos.left }">
        <div class="dd-title">切换分支</div>
        <div class="dd-list">
          <div
            v-for="b in git.branches"
            :key="b.name"
            class="dd-item"
            :class="{ current: b.current }"
            :title="b.lastCommit"
            @click="onCheckout(b)"
          >
            <span class="dd-mark">
              <Icon v-if="b.current" name="check" :size="12" />
            </span>
            <span class="dd-name">{{ b.name }}</span>
            <button
              v-if="!b.current"
              class="mini danger"
              title="删除分支"
              @click.stop="onDeleteBranch(b)"
            >
              <Icon name="trash" :size="12" />
            </button>
          </div>
        </div>
        <div class="dd-new">
          <input
            v-model="newBranch"
            class="dd-input"
            placeholder="新分支名"
            @keydown.enter.prevent="onCreateBranch"
          />
          <button
            class="dd-add"
            :disabled="!newBranch.trim()"
            title="新建并切换"
            @click="onCreateBranch"
          >
            <Icon name="plus" :size="12" />
          </button>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.git-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
/* 左栏宽度由内联 style 决定（可拖拽，见 changesWidth），右栏吃掉剩余宽度 */
.col-changes {
  flex: 0 0 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 拖拽手柄：细条，hover 时才显色，不干扰面板本身的视觉分隔 */
.resize-handle {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
}
.resize-handle:hover { background: var(--accent); }
.col-log {
  flex: 1;
  min-width: 0;
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
/* 分支名做成按钮：点击弹出切换/新建下拉 */
.branch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 60%;
  height: 22px;
  padding: 0 5px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font: inherit;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  cursor: pointer;
}
.branch-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.branch { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

/* —— 右栏：提交历史图 —— */
.log-head {
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
.log-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}
.log-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}
.log-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 8px;
  font-size: var(--fs-caption);
  color: var(--text-primary);
  cursor: pointer;
}
.log-row:hover,
.log-row.expanded { background: var(--code-hover); }
/* 图形前缀必须等宽且保留空格（缩进就是分支层级）。
   行高固定成 16px：graph 与右侧两行文本要首行对齐，不能靠 line-height: normal 各算各的 */
.graph {
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  white-space: pre;
  line-height: 16px;
  color: var(--text-tertiary);
}
.log-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.log-line-1 {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.log-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-meta {
  font-size: 11px;
  line-height: 15px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 10px;
  line-height: 15px;
}
.ref-head { color: var(--accent); border-color: var(--accent); }
.ref-branch { color: var(--status-ok); border-color: var(--status-ok); }
.ref-remote { color: var(--text-tertiary); border-color: var(--border); }
.ref-tag { color: var(--status-warn); border-color: var(--status-warn); }
/* 展开的提交详情：重置操作条 + 文件列表，整体缩进到图形列之后 */
.commit-detail {
  padding-left: 22px;
  border-top: 1px solid var(--border);
}
.commit-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 2px;
}
.ca-label {
  margin-right: 2px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.ca-btn {
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.ca-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.ca-btn.danger:hover { color: var(--status-error); border-color: var(--status-error); }
.commit-files {
  padding: 2px 0 5px;
}
.commit-file {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 8px;
  font-size: var(--fs-caption);
  color: var(--text-primary);
  cursor: pointer;
}
.commit-file:hover { background: var(--code-hover); }
.commit-file .path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 提交内文件的状态色，与变更列表的 st-* 同一套语义 */
.st-cf-A { color: var(--status-ok); }
.st-cf-D { color: var(--status-error); }
.st-cf-M { color: var(--status-warn); }
.st-cf-R { color: var(--accent); }
.st-cf-C { color: var(--accent); }
.st-cf-U { color: var(--status-error); }

/* —— stash 区 —— */
.stash-section {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}
.stash-head {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
}
.stash-head:hover { color: var(--text-secondary); }
.stash-head .open { transform: rotate(90deg); }
.stash-list {
  max-height: 120px;
  overflow-y: auto;
  padding-bottom: 2px;
}
.stash-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px 0 18px;
  font-size: var(--fs-caption);
  color: var(--text-primary);
}
.stash-row:hover { background: var(--code-hover); }
.stash-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stash-row:hover .row-actions { display: inline-flex; }

/* —— 分支下拉（Teleport 到 body，定位由 ddPos 给定）—— */
.dd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.branch-dd {
  position: fixed;
  z-index: 41;
  min-width: 200px;
  max-width: 320px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
}
.dd-title {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.dd-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.dd-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 4px 0 6px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  color: var(--text-primary);
  cursor: pointer;
}
.dd-item:hover { background: var(--code-hover); }
.dd-item.current { color: var(--accent); }
.dd-mark {
  width: 14px;
  flex-shrink: 0;
  display: inline-flex;
  justify-content: center;
}
.dd-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 删除按钮只在悬停该行时出现，避免列表看起来一片红 */
.dd-item .mini { visibility: hidden; }
.dd-item:hover .mini { visibility: visible; }
.dd-new {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.dd-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--fs-caption);
}
.dd-input:focus { outline: none; border-color: var(--border-focus); }
.dd-add {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--text-inverse);
  cursor: pointer;
}
.dd-add:disabled { opacity: 0.4; cursor: default; }
</style>
