<template>
  <div class="channel-tab">
    <aside class="channel-sidebar">
      <div class="list-header">
        <span>通道</span>
        <button class="add-btn" aria-label="新增通道" title="新增通道" @click="showAddDialog = true">
          <Icon name="plus" :size="14" />
        </button>
      </div>
      <div class="list">
        <div
          v-for="c in store.list"
          :key="c.id"
          class="channel-item"
          :class="{ active: c.id === selectedId, current: c.enabled }"
          @click="selectedId = c.id"
        >
          <Icon :name="typeInfo(c.type)?.icon ?? 'puzzle'" :size="14" class="ch-icon" />
          <div class="ch-info">
            <div class="ch-name">{{ c.name }}</div>
            <div class="ch-desc">{{ typeInfo(c.type)?.description ?? '' }}</div>
          </div>
          <span v-if="c.enabled" class="badge">当前</span>
        </div>
        <div v-if="store.list.length === 0" class="empty-list">
          暂无通道，点击 + 新增
        </div>
      </div>
    </aside>

    <section v-if="selected" class="channel-detail">
      <div class="detail-header">
        <h3>{{ selected.name }}</h3>
        <div class="detail-actions">
          <button
            v-if="!selected.enabled"
            class="btn-primary"
            :disabled="store.dirty"
            @click="onEnable"
          >启用</button>
          <button class="btn-danger" @click="onDelete">删除</button>
        </div>
      </div>

      <div class="detail-body">
        <div class="form-group">
          <label>名称</label>
          <input class="v" v-model="selected.name" @input="store.markDirty()" />
        </div>
        <div class="form-group">
          <label>类型</label>
          <input class="v" :value="typeInfo(selected.type)?.name ?? selected.type" disabled />
        </div>

        <WeComConfig
          v-if="selected.type === 'wecom'"
          v-model="selected.config"
          @dirty="store.markDirty()"
        />
        <FeishuConfig
          v-else-if="selected.type === 'feishu'"
          v-model="selected.config"
          @dirty="store.markDirty()"
        />
        <LocalFileConfig
          v-else-if="selected.type === 'localfile'"
          v-model="selected.config"
          @dirty="store.markDirty()"
        />
      </div>

      <div class="actions">
        <div class="spacer" />
        <button class="btn-cancel" :disabled="!store.dirty" @click="onCancel">取消</button>
        <button class="btn-save" :disabled="!store.dirty" @click="onSave">保存</button>
      </div>
    </section>

    <div v-else class="channel-empty">
      <span>选择左侧通道</span>
    </div>

    <!-- 新增通道对话框 -->
    <div v-if="showAddDialog" class="add-overlay" @click.self="showAddDialog = false">
      <div class="add-dialog">
        <h3>新增通道</h3>
        <div class="type-list">
          <div
            v-for="t in CHANNEL_TYPES"
            :key="t.type"
            class="type-item"
            @click="onAddChannel(t.type)"
          >
            <Icon :name="t.icon" :size="20" />
            <div class="type-info">
              <span class="type-name">{{ t.name }}</span>
              <span class="type-desc">{{ t.description }}</span>
            </div>
          </div>
        </div>
        <button class="btn-cancel" @click="showAddDialog = false">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Icon from '../../components/Icon.vue'
import WeComConfig from './WeComConfig.vue'
import FeishuConfig from './FeishuConfig.vue'
import LocalFileConfig from './LocalFileConfig.vue'
import { useChannelsStore } from '../../stores/channels'
import { CHANNEL_TYPES, type ChannelTypeInfo } from '../../types/channels'
import { showToast } from '../../composables/useToast'

const store = useChannelsStore()
const selectedId = ref('')
const showAddDialog = ref(false)

function typeInfo(type: string): ChannelTypeInfo | undefined {
  return CHANNEL_TYPES.find(t => t.type === type)
}

const selected = computed(() => {
  if (!selectedId.value) return null
  return store.data[selectedId.value] ?? null
})

onMounted(() => store.load())

async function onEnable() {
  if (!selected.value) return
  try {
    await store.setActive(selected.value.id)
    showToast('已启用')
  } catch (e: any) {
    showToast('启用失败：' + (e?.message ?? e), 'error')
  }
}

async function onSave() {
  try {
    if (!selected.value) return
    await store.save(selected.value.id)
    showToast('保存成功')
  } catch (e: any) {
    showToast('保存失败：' + (e?.message ?? e), 'error')
  }
}

async function onCancel() {
  await store.load()
  if (!store.data[selectedId.value]) {
    selectedId.value = store.list[0]?.id ?? ''
  }
}

async function onDelete() {
  if (!selected.value) return
  if (!confirm(`确定删除通道「${selected.value.name}」吗？`)) return
  const id = selected.value.id
  selectedId.value = store.list.find(c => c.id !== id)?.id ?? ''
  try {
    await store.removeChannel(id)
    showToast('已删除')
  } catch (e: any) {
    showToast('删除失败：' + (e?.message ?? e), 'error')
    await store.load()
    selectedId.value = id
  }
}

function onAddChannel(type: string) {
  const id = store.addChannel(type)
  selectedId.value = id
  showAddDialog.value = false
}
</script>

<style scoped>
.channel-tab { display: flex; height: 100%; }

.channel-sidebar {
  width: 220px; background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.list-header {
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  font-weight: 600; font-size: 13px; color: var(--text-primary);
  display: flex; justify-content: space-between; align-items: center;
}
.add-btn {
  width: 24px; height: 24px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-input);
  color: var(--text-primary); cursor: pointer; display: flex;
  align-items: center; justify-content: center;
}
.add-btn:hover { border-color: var(--accent); color: var(--accent-light); }
.list { flex: 1; overflow-y: auto; padding: 8px; }
.empty-list { padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 12px; }
.channel-item {
  padding: 10px 12px; border-radius: var(--radius-md);
  cursor: pointer; margin-bottom: 4px;
  display: flex; align-items: center; gap: 10px;
  border: 1px solid transparent;
  color: var(--text-secondary);
}
.channel-item:hover { background: var(--bg-input); }
.channel-item:active { background: var(--border); }
.channel-item.active { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--accent-light); }
.ch-icon { flex-shrink: 0; }
.ch-info { flex: 1; min-width: 0; }
.ch-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-desc { font-size: 10px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.badge { font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; flex-shrink: 0; }

.channel-detail { flex: 1; padding: 16px 20px; display: flex; flex-direction: column; min-width: 0; overflow-y: auto; }
.detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.detail-header h3 { font-size: 15px; margin: 0; }
.detail-actions { display: flex; gap: 8px; }
.btn-primary {
  padding: 5px 14px; background: var(--accent); color: #fff;
  border: none; border-radius: var(--radius-md); font-size: 12px; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger { padding: 5px 14px; border: 1px solid var(--status-error); color: var(--status-error); background: none; border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-danger:hover { background: var(--status-error); color: #fff; }

.detail-body { flex: 1; overflow-y: auto; }
.form-group { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.form-group label { width: 50px; font-size: 12px; color: var(--text-primary); padding-top: 7px; flex-shrink: 0; }
.form-group input.v {
  flex: 1; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.form-group input.v:focus { outline: none; border-color: var(--accent); }
.form-group input.v:disabled { opacity: 0.5; }

.actions { display: flex; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); flex-shrink: 0; }
.spacer { flex: 1; }
.btn-save { padding: 7px 20px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }

.channel-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: 13px; }

.add-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.add-dialog { width: 360px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; }
.add-dialog h3 { font-size: 14px; margin: 0 0 14px; }
.type-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.type-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border-radius: var(--radius-md); cursor: pointer;
  border: 1px solid var(--border);
}
.type-item:hover { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); }
.type-name { font-size: 13px; font-weight: 500; }
.type-desc { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
</style>
