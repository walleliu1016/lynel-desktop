<template>
  <Teleport to="body">
    <div class="dialog-mask" @click.self="onClose">
      <div class="dialog">
        <div class="dialog-head">
          <h3>添加机器人</h3>
          <button class="close" aria-label="关闭" @click="onClose">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">名称</label>
          <input class="v" v-model="form.name" placeholder="如：我的助手" />
        </div>
        <div class="form-group">
          <label class="form-label">来源</label>
          <select class="v" v-model="form.source">
            <option value="wecom">企业微信</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Bot ID</label>
          <input class="v" v-model="form.botId" placeholder="企业微信 bot ID" />
        </div>
        <div class="form-group">
          <label class="form-label">Secret</label>
          <input class="v" v-model="form.secret" type="password" placeholder="bot secret" />
        </div>

        <div class="dialog-foot">
          <div class="spacer" />
          <button class="cancel" @click="onClose">取消</button>
          <button class="save" :disabled="!valid" @click="onSave">保存并绑定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, computed, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'
import type { BotItem, BotSource } from '../types/bots'
import { useBotsStore } from '../stores/bots'
import { pushToast } from '../composables/useToast'

const emit = defineEmits<{
  (e: 'saved', botId: string): void
  (e: 'close'): void
}>()

const store = useBotsStore()

const form = reactive<{ name: string; source: BotSource; botId: string; secret: string }>({
  name: '',
  source: 'wecom',
  botId: '',
  secret: '',
})

const valid = computed(() =>
  form.name.trim() && form.botId.trim() && form.secret.trim()
)

function onClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onClose()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

async function onSave() {
  if (!valid.value) return
  try {
    const now = Date.now()
    const bot: BotItem = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      source: form.source || 'wecom',
      botId: form.botId.trim(),
      secret: form.secret.trim(),
      chatId: '',
      createdAt: now,
      updatedAt: now,
      connected: false,
    }
    await store.save(bot)
    emit('saved', bot.id)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'bot', message: '保存失败：' + (e?.message ?? e) })
  }
}
</script>

<style scoped>
.dialog-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
}
.dialog {
  width: 420px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px;
}
.dialog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dialog-head h3 { margin: 0; font-size: 16px; color: var(--text-primary); }
.close { background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 4px; }
.close:hover { color: var(--text-primary); }
.form-group { margin-bottom: 12px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-group .v {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px; color: var(--text-primary);
  font-size: 12px; font-family: inherit; box-sizing: border-box;
}
.form-group .v:focus { outline: none; border-color: var(--accent); }
.form-group .v[type="password"] { font-family: var(--font-mono); }
.dialog-foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.dialog-foot .spacer { flex: 1; }
.dialog-foot button {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
  font-family: inherit;
}
.dialog-foot button.cancel:hover { background: var(--border); }
.dialog-foot button.save { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
.dialog-foot button.save:hover:not(:disabled) { background: var(--accent-deep); }
.dialog-foot button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
