<!-- 任务面板左栏：搜索 / 筛选浮层 / 两行式任务行。
     启停不设常驻开关，hover 或选中行时才淡入 power 按钮，默认靠颜色区分启用态。 -->
<template>
  <div class="tlist" :style="{ width: width + 'px' }">
    <div class="tlist-hd">
      <button class="btn primary" @click="$emit('create')"><Icon name="plus" :size="14" />新建任务</button>
    </div>
    <div class="filters">
      <div class="search">
        <Icon name="search" :size="12" />
        <input v-model="keyword" placeholder="搜索任务…" />
      </div>
      <div class="filterwrap">
        <button class="btn" :class="{ on: filterOpen }" @click="filterOpen = !filterOpen">
          <Icon name="filter" :size="14" />筛选
        </button>
        <div v-if="filterOpen" class="dropdown">
          <div class="dd-hd">状态</div>
          <div
            v-for="opt in FILTERS"
            :key="opt.value"
            class="dd-item"
            :class="{ on: filter === opt.value }"
            @click="filter = opt.value"
          >
            <span class="dot2" />{{ opt.label }}
          </div>
          <div class="dd-sep" />
          <div class="dd-acts">
            <button class="btn" @click="batch(true)">全部启用</button>
            <button class="btn" @click="batch(false)">全部停用</button>
          </div>
        </div>
      </div>
    </div>

    <div class="trows">
      <template v-for="group in grouped" :key="group.label">
        <div v-if="group.label" class="group-label">{{ group.label }}</div>
        <div
          v-for="t in group.items"
          :key="t.id"
          class="trow"
          :class="{ sel: t.id === activeId, off: !t.enabled }"
          @click="$emit('select', t.id)"
        >
          <span class="sd" :class="statusClass(t)" />
          <span class="nm">{{ t.name }}</span>
          <button
            class="toggle"
            :title="t.enabled ? '停用' : '启用'"
            @click.stop="$emit('toggle', t.id, !t.enabled)"
          >
            <Icon name="power" :size="12" />
          </button>
          <span class="meta">
            {{ t.schedule }}
            <span class="next">· {{ nextText(t) }}</span>
          </span>
        </div>
      </template>
      <div v-if="visible.length === 0" class="empty">暂无任务</div>
    </div>

    <div class="drag-handle" @mousedown="$emit('start-resize', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import { formatNextRun } from '../../utils/tasks'
import type { TaskDto } from '../../types/tasks'

const props = defineProps<{ tasks: TaskDto[]; activeId: string | null; width: number }>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'toggle', id: string, enabled: boolean): void
  (e: 'create'): void
  (e: 'start-resize', ev: MouseEvent): void
}>()

type FilterValue = 'all' | 'enabled' | 'disabled' | 'failed'
const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
  { value: 'failed', label: '上次失败' },
]
const FAILED = new Set(['error', 'timeout', 'interrupted'])

const keyword = ref('')
const filter = ref<FilterValue>('all')
const filterOpen = ref(false)

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.tasks.filter((t) => {
    if (kw && !t.name.toLowerCase().includes(kw) && !t.prompt.toLowerCase().includes(kw)) return false
    if (filter.value === 'enabled' && !t.enabled) return false
    if (filter.value === 'disabled' && t.enabled) return false
    if (filter.value === 'failed' && !FAILED.has(t.lastStatus ?? '')) return false
    return true
  })
})

/** 启用且有待运行时间的排前面（按 nextRunAt 升序），停用/无下次的沉底成一组 */
const grouped = computed(() => {
  const pending = visible.value
    .filter((t) => t.enabled && t.nextRunAt != null)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
  const rest = visible.value
    .filter((t) => !(t.enabled && t.nextRunAt != null))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  const groups: Array<{ label: string; items: TaskDto[] }> = []
  if (pending.length) groups.push({ label: '', items: pending })
  if (rest.length) groups.push({ label: '已停用 / 已过期', items: rest })
  return groups
})

function statusClass(t: TaskDto): string {
  if (FAILED.has(t.lastStatus ?? '')) return 'err'
  if (t.lastStatus === 'running') return 'run'
  return t.enabled ? 'on' : 'off'
}

function nextText(t: TaskDto): string {
  if (!t.enabled) return t.lastStatus === 'missed' ? '已过期' : '已停用'
  if (t.nextRunAt == null) return '—'
  return formatNextRun(t.nextRunAt)
}

async function batch(on: boolean) {
  filterOpen.value = false
  for (const t of visible.value) {
    if (t.enabled !== on) emit('toggle', t.id, on)
  }
}
</script>

<style scoped>
.tlist {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  min-height: 0;
}
.tlist-hd {
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}
.btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px;
  border-radius: var(--radius-sm); font-size: var(--fs-caption);
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); cursor: pointer; font-family: inherit;
}
.btn:hover { background: var(--bg-hover); }
.btn.primary { background: var(--accent); color: var(--text-inverse); border-color: transparent; }
.btn.primary:hover { background: var(--accent-deep); }
.filters {
  padding: 8px 10px; display: flex; gap: 6px; align-items: center;
  border-bottom: 1px solid var(--border);
}

/* 任务行容器：任务多时要能滚（设计稿是定高展示，故写死 overflow:hidden） */
.trows { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
.trow {
  display: grid; grid-template-columns: auto 1fr auto; gap: 4px 9px;
  align-items: center; padding: 8px 10px 8px 12px; cursor: pointer;
  border-left: 2px solid transparent;
}
.trow:hover { background: var(--bg-hover); }
.trow.sel { background: var(--bg-selected); border-left-color: var(--accent); }
.trow .nm {
  font-size: var(--fs-body-sm); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.trow .meta { grid-column: 2; font-size: var(--fs-caption); color: var(--text-secondary); }
.trow .next { color: var(--text-tertiary); }

/* 启用/停用靠颜色区分，不用常驻开关 */
.trow.off .nm { color: var(--text-tertiary); font-weight: 400; }
.trow.off .meta { opacity: .62; }

/* 状态点：小、只做颜色语义 */
.sd { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.sd.on { background: var(--status-success); }
.sd.off { background: var(--text-tertiary); opacity: .45; }
.sd.run { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-bg); }
.sd.err { background: var(--status-error); }

/* 启停按钮：hover / 选中行才露出 */
.toggle {
  width: 22px; height: 22px; border: none; background: transparent;
  border-radius: var(--radius-sm); padding: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); opacity: 0; transition: opacity .12s;
}
.trow:hover .toggle { opacity: 1; }
.trow.sel .toggle { opacity: .5; }
.toggle:hover { background: var(--bg-hover); color: var(--text-primary); }

.group-label {
  padding: 10px 12px 4px; font-size: 10px; letter-spacing: .6px;
  color: var(--text-tertiary); text-transform: uppercase;
}

/* 搜索框（内嵌图标） */
.search {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
  padding: 0 8px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-input);
}
.search:focus-within { border-color: var(--border-focus); }
.search :deep(svg) { color: var(--text-tertiary); flex: none; }
.search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: var(--fs-caption);
  color: var(--text-primary); padding: 5px 0;
}
.search input::placeholder { color: var(--text-tertiary); }

/* 筛选下拉（展开态是浮层，不占位） */
.filterwrap { position: relative; flex: none; }
.filterwrap .btn.on { border-color: var(--accent); color: var(--accent); background: var(--bg-card); }
.dropdown {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 5;
  width: 196px; padding: 6px;
  background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md); box-shadow: var(--shadow-panel);
}
.dd-hd {
  font-size: 10px; letter-spacing: .6px; text-transform: uppercase;
  color: var(--text-tertiary); padding: 5px 8px 4px;
}
.dd-item {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px;
  border-radius: var(--radius-sm); font-size: var(--fs-caption);
  color: var(--text-secondary); cursor: pointer;
}
.dd-item:hover { background: var(--bg-hover); }
.dd-item .dot2 {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid var(--text-tertiary); flex: none;
}
.dd-item.on { color: var(--accent); }
.dd-item.on .dot2 { border-color: var(--accent); border-width: 3.5px; }
.dd-sep { height: 1px; background: var(--border); margin: 6px 4px; }
.dd-acts { display: flex; gap: 6px; padding: 2px 4px 4px; }
.dd-acts .btn { flex: 1; justify-content: center; }

/* 空状态 */
.empty { padding: 24px 12px; text-align: center; font-size: var(--fs-caption); color: var(--text-tertiary); }

/* 拖拽热区：贴在左栏右边缘（绝对定位，不参与列表纵向排布），hover 才显色 */
.drag-handle {
  position: absolute; top: 0; right: 0; bottom: 0; width: 4px;
  cursor: col-resize; background: transparent; z-index: 6;
}
.drag-handle:hover { background: var(--accent); }
</style>
