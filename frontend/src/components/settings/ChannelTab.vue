<template>
  <div class="channel-tab">
    <div class="channel-sidebar">
      <div
        v-for="ch in channels"
        :key="ch.id"
        class="channel-item"
        :class="{ active: active === ch.id }"
        @click="selectChannel(ch.id)"
      >
        <div class="channel-item-left">
          <Icon :name="ch.icon" :size="16" />
          <div class="channel-item-info">
            <span class="channel-name">{{ ch.name }}</span>
            <span class="channel-desc">{{ ch.description }}</span>
          </div>
        </div>
        <Switch
          :modelValue="configs[ch.id]?.enabled ?? false"
          @update:modelValue="(v: boolean) => toggleChannel(ch.id, v)"
        />
      </div>
    </div>

    <div class="channel-detail">
      <div class="detail-header">
        <h3>{{ currentChannel?.name ?? '' }}</h3>
        <span v-if="currentChannel" class="channel-status" :class="{ on: configs[currentChannel.id]?.enabled }">
          {{ configs[currentChannel.id]?.enabled ? '已启用' : '未启用' }}
        </span>
      </div>
      <div class="detail-body">
        <WeComConfig
          v-if="active === 'wecom'"
          :modelValue="configs.wecom"
          :disabled="saving"
          @update:modelValue="(v) => configs.wecom = v"
          @dirty="markDirty"
        />
        <FeishuConfig
          v-else-if="active === 'feishu'"
          :modelValue="configs.feishu"
          :disabled="saving"
          @update:modelValue="(v) => configs.feishu = v"
          @dirty="markDirty"
        />
        <LocalFileConfig
          v-else-if="active === 'localfile'"
          :modelValue="configs.localfile"
          :disabled="saving"
          @update:modelValue="(v) => configs.localfile = v"
          @dirty="markDirty"
        />
      </div>
      <div class="actions">
        <div class="spacer" />
        <button class="btn-cancel" :disabled="!dirty || saving" @click="onCancel">取消</button>
        <button class="btn-save" :disabled="!dirty || saving" @click="onSave">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import Icon from '../../components/Icon.vue'
import Switch from '../../components/Switch.vue'
import WeComConfig from './WeComConfig.vue'
import FeishuConfig from './FeishuConfig.vue'
import LocalFileConfig from './LocalFileConfig.vue'
import { GetChannelsConfig, UpdateChannelConfig } from '../../composables/useElectron'
import { showToast } from '../../composables/useToast'

interface ChannelDef {
  id: string
  name: string
  icon: string
  description: string
}

const channels: ChannelDef[] = [
  { id: 'wecom', name: '企业微信', icon: 'message-square', description: '推送到企业微信群聊或单聊' },
  { id: 'feishu', name: '飞书', icon: 'send', description: '推送到飞书群聊或单聊' },
  { id: 'localfile', name: '本地文件', icon: 'file-text', description: '输出到本地 JSONL / JSON 文件' },
]

function defaultConfig(ch: ChannelDef) {
  const base: Record<string, any> = { wecom: { enabled: false, chatId: '', botId: '', secret: '' }, feishu: { enabled: false, webhookUrl: '', secret: '' }, localfile: { enabled: false, outputPath: '', format: 'jsonl' } }
  return { ...base[ch.id] }
}

const active = ref('wecom')
const configs = reactive<Record<string, any>>({})
const dirty = ref(false)
const saving = ref(false)

const currentChannel = computed(() => channels.find((c) => c.id === active.value))

onMounted(async () => {
  await load()
})

async function load() {
  try {
    const raw = (await GetChannelsConfig()) as Record<string, any> | null
    for (const ch of channels) {
      configs[ch.id] = { ...defaultConfig(ch), ...(raw?.[ch.id] || {}) }
    }
    dirty.value = false
  } catch (e: any) {
    showToast('加载配置失败：' + (e?.message ?? e), 'error')
  }
}

function selectChannel(id: string) {
  active.value = id
}

function toggleChannel(id: string, v: boolean) {
  if (v) {
    for (const ch of channels) {
      configs[ch.id] = { ...configs[ch.id], enabled: ch.id === id }
    }
  } else {
    configs[id] = { ...configs[id], enabled: false }
  }
  markDirty()
}

function markDirty() {
  dirty.value = true
}

async function onSave() {
  saving.value = true
  try {
    for (const ch of channels) {
      await UpdateChannelConfig(ch.id, { ...configs[ch.id] })
    }
    dirty.value = false
    showToast('保存成功')
  } catch (e: any) {
    showToast('保存失败：' + (e?.message ?? e), 'error')
  } finally {
    saving.value = false
  }
}

async function onCancel() {
  await load()
}
</script>

<style scoped>
.channel-tab {
  display: flex;
  height: 100%;
  margin: -12px -16px;
}

/* sidebar */
.channel-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.channel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
  color: var(--text-secondary);
}
.channel-item:hover { background: var(--bg-input); color: var(--text-primary); }
.channel-item.active { background: var(--accent-soft-bg); color: var(--accent-light); }

.channel-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.channel-item-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.channel-name { font-size: 13px; font-weight: 500; line-height: 1.3; }
.channel-desc { font-size: 10px; color: var(--text-tertiary); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* detail */
.channel-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px 20px;
  overflow-y: auto;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  flex-shrink: 0;
}
.detail-header h3 {
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 600;
  margin: 0;
}

.channel-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-tertiary);
}
.channel-status.on {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
}

.detail-body {
  flex: 1;
  overflow-y: auto;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.spacer { flex: 1; }
.btn-save { padding: 7px 20px; background: var(--accent); color: white; border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover:not(:disabled) { background: var(--border); }
.btn-save:disabled, .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
