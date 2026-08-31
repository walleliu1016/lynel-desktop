<template>
  <!-- 独立弹窗模式（默认）：带遮罩与标题/取消栏 -->
  <Teleport v-if="!embedded" to="body">
    <div class="dialog-mask" @click.self="onCancel">
      <div class="dialog">
        <div class="dialog-head">
          <h3>扫码创建机器人</h3>
          <button class="close" aria-label="关闭" @click="onCancel">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">名称（选填）</label>
          <input class="v" v-model="name" placeholder="默认：企业微信机器人" />
        </div>

        <div class="qr-area">
          <div v-if="status === 'pending'">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="企业微信扫码" class="qr-img" />
            <p class="qr-hint">请用手机企业微信扫描二维码，确认后自动创建并绑定</p>
            <div class="qr-wait">
              <Icon name="loader" :size="14" class="spin" />
              <span>等待扫码...</span>
            </div>
          </div>
          <div v-else-if="status === 'timeout'" class="qr-state">
            <p>扫码超时，请重新生成。</p>
            <button class="retry" @click="start">重新生成</button>
          </div>
          <div v-else class="qr-state">
            <p>{{ error }}</p>
            <button class="retry" @click="start">重试</button>
          </div>
        </div>

        <div class="dialog-foot">
          <div class="spacer" />
          <button class="cancel" @click="onCancel">取消</button>
        </div>
      </div>
    </div>
  </Teleport>
  <!-- 内嵌模式：仅内容块，外壳（标题/底部按钮）由宿主弹窗统一管理 -->
  <div v-else class="qr-embedded">
    <div class="form-group">
      <label class="form-label">名称（选填）</label>
      <input class="v" v-model="name" placeholder="默认：企业微信机器人" />
    </div>

    <div class="qr-area">
      <div v-if="status === 'pending'">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="企业微信扫码" class="qr-img" />
        <p class="qr-hint">请用手机企业微信扫描二维码，确认后自动创建并绑定</p>
        <div class="qr-wait">
          <Icon name="loader" :size="14" class="spin" />
          <span>等待扫码...</span>
        </div>
      </div>
      <div v-else-if="status === 'timeout'" class="qr-state">
        <p>扫码超时，请重新生成。</p>
        <button class="retry" @click="start">重新生成</button>
      </div>
      <div v-else class="qr-state">
        <p>{{ error }}</p>
        <button class="retry" @click="start">重试</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import QRCode from 'qrcode'
import Icon from './Icon.vue'
import { StartWecomScan, CancelWecomScan, OnWecomScanResult } from '../composables/useElectron'
import type { ScanEvent } from '../../../main/wecom-scan.js'

defineProps<{ embedded?: boolean }>()

const emit = defineEmits<{
  (e: 'success', bot: { name: string; botId: string; secret: string }): void
  (e: 'close'): void
}>()

const name = ref('')
const qrDataUrl = ref('')
const status = ref<'pending' | 'timeout' | 'error'>('pending')
const error = ref('')
let unsub: (() => void) | null = null

async function start() {
  status.value = 'pending'
  error.value = ''
  qrDataUrl.value = ''
  try {
    const res: any = await StartWecomScan()
    if (!res?.ok) {
      status.value = 'error'
      error.value = res?.error || '获取二维码失败，请重试'
      return
    }
    qrDataUrl.value = await QRCode.toDataURL(res.authUrl, { width: 220, margin: 1 })
  } catch (e: any) {
    status.value = 'error'
    error.value = '获取二维码失败：' + (e?.message ?? e)
  }
}

function onScanEvent(e: ScanEvent) {
  if (e.type === 'success') {
    cleanup()
    emit('success', {
      name: name.value.trim() || '企业微信机器人',
      botId: e.botId,
      secret: e.secret,
    })
  } else if (e.type === 'timeout') {
    status.value = 'timeout'
  } else if (e.type === 'error') {
    status.value = 'error'
    error.value = e.message
  }
}

function cleanup() {
  if (unsub) { unsub(); unsub = null }
}

onMounted(() => {
  unsub = OnWecomScanResult(onScanEvent)
  void start()
})

onUnmounted(() => {
  cleanup()
  void CancelWecomScan()
})

function onCancel() {
  emit('close')
}
</script>

<style scoped>
/* 内嵌模式：内容块随宿主宽度自适应 */
.qr-embedded .qr-img { width: 200px; height: 200px; }
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
.qr-area {
  display: flex; flex-direction: column; align-items: center;
  padding: 12px; background: var(--bg-hover); border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
/* pending/error 内容块撑满并内部居中，避免二维码因外层 div 宽度被文本撑开而靠左 */
.qr-area > div {
  width: 100%; display: flex; flex-direction: column; align-items: center;
}
.qr-img {
  width: 220px; height: 220px; background: #fff; padding: 8px;
  border-radius: 6px; box-sizing: border-box;
}
.qr-hint { font-size: 12px; color: var(--text-secondary); margin-top: 8px; text-align: center; }
.qr-wait { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); margin-top: 6px; }
.qr-wait .spin { animation: scan-spin 1s linear infinite; }
.qr-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; font-size: 12px; color: var(--text-secondary); }
.qr-state .retry {
  padding: 6px 14px; border-radius: var(--radius-md); border: 1px solid var(--accent);
  background: var(--accent); color: var(--text-inverse); cursor: pointer; font-size: 12px;
}
@keyframes scan-spin { to { transform: rotate(360deg); } }
.dialog-foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.dialog-foot .spacer { flex: 1; }
.dialog-foot button {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
  font-family: inherit;
}
.dialog-foot button.cancel:hover { background: var(--border); }
</style>
