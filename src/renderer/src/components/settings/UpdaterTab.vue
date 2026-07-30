<template>
  <div class="updater-tab">
    <h2>在线升级</h2>

    <div class="form-group">
      <label class="form-label">当前版本</label>
      <div class="version-row">
        <span class="version-text">{{ currentVersion }}</span>
        <button class="btn-check" :disabled="checking" @click="onCheckUpdate">
          {{ checking ? '检查中...' : '检查更新' }}
        </button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">更新通道</label>
      <span class="form-static">Stable</span>
      <p class="form-hint">Beta 版本请手动下载安装。更新源优先使用 GitHub Releases，云服务地址已配置时作为 fallback。</p>
    </div>

    <div class="status-area" v-if="statusText">
      <div :class="['status-line', statusClass]">
        <span class="status-dot" />
        {{ statusText }}
        <button
          v-if="state.status === 'available'"
          class="btn-download"
          @click="onDownload"
        >立即下载</button>
      </div>
      <div v-if="state.status === 'downloading'" class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: (state.data?.percent ?? 0) + '%' }" />
        </div>
        <span class="progress-text">{{ Math.round(state.data?.percent ?? 0) }}%</span>
      </div>
      <div v-if="state.status === 'downloaded'" class="install-hint">
        下载完成，重启应用以安装新版本。
        <button class="btn-restart" @click="onRestart">立即重启</button>
        <button class="btn-later" @click="state.status = 'idle'">稍后</button>
      </div>
      <div v-if="state.status === 'error'" class="error-hint">
        {{ state.data?.error }}
        <button class="btn-retry" @click="onCheckUpdate">重试</button>
      </div>
      <div v-if="state.status === 'available' && checkResult?.forceUpdate" class="force-overlay">
        <div class="force-dialog">
          <h3>必须更新</h3>
          <p>需要更新到 {{ checkResult?.version }} 才能继续使用。</p>
          <p class="force-notes">{{ checkResult?.releaseNotes }}</p>
          <button class="btn-download" @click="onDownload">立即更新</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  CheckUpdate, DownloadUpdate, QuitAndInstall,
  GetUpdateStatus, EventsOn,
} from '../../composables/useElectron'
import { pushToast } from '../../composables/useToast'

const state = reactive<{ status: string; data?: Record<string, any> }>({ status: 'idle' })
const checking = ref(false)
const checkResult = ref<Record<string, any> | null>(null)
const currentVersion = ref('')

const statusText = computed(() => {
  switch (state.status) {
    case 'checking': return '正在检查更新...'
    case 'available': return `新版本 ${state.data?.version ?? ''} 可用`
    case 'downloading': return `正在下载 ${state.data?.version ?? ''}...`
    case 'downloaded': return `v${state.data?.version ?? ''} 下载完成`
    case 'no-update': return '已是最新版本'
    case 'error': return '检查更新失败'
    default: return ''
  }
})

const statusClass = computed(() => {
  switch (state.status) {
    case 'error': return 'status-error'
    case 'no-update': return 'status-ok'
    default: return 'status-info'
  }
})

onMounted(async () => {
  try {
    const status = await GetUpdateStatus()
    currentVersion.value = status?.currentVersion ?? ''
  } catch {}
})

EventsOn('update:state', (s: any) => {
  Object.assign(state, s)
})

async function onCheckUpdate() {
  checking.value = true
  try {
    const result = await CheckUpdate()
    checkResult.value = result
  } catch (e: any) {
    pushToast({ level: 'error', source: 'updater', message: '检查更新失败：' + (e?.message ?? e) })
  } finally {
    checking.value = false
  }
}

async function onDownload() {
  if (!checkResult.value) {
    checkResult.value = {
      hasUpdate: true,
      version: state.data?.version,
      downloadUrl: '',
      sha512: '',
      size: 0,
    }
  }
  try {
    await DownloadUpdate(checkResult.value)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'updater', message: '下载失败：' + (e?.message ?? e) })
  }
}

function onRestart() {
  QuitAndInstall()
}
</script>

<style scoped>
.updater-tab { padding: 20px 24px; max-width: 560px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 20px; }

.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-static { font-size: 13px; color: var(--text-primary); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

.version-row { display: flex; align-items: center; gap: 12px; }
.version-text { font-size: 13px; color: var(--text-primary); font-family: var(--font-mono); }
.btn-check {
  padding: 5px 14px; background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-primary); border-radius: var(--radius-md); font-size: 12px; cursor: pointer;
}
.btn-check:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn-check:disabled { opacity: 0.5; cursor: not-allowed; }

.status-area { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
.status-line { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-info .status-dot { background: var(--accent); }
.status-ok .status-dot { background: var(--status-success); }
.status-error .status-dot { background: var(--status-error); }
.status-info { color: var(--accent); }
.status-ok { color: var(--status-success); }
.status-error { color: var(--status-error); }

.btn-download, .btn-restart, .btn-retry {
  padding: 4px 12px; background: var(--accent); color: white;
  border: none; border-radius: var(--radius-md); font-size: 12px; cursor: pointer; margin-left: 8px;
}
.btn-download:hover, .btn-restart:hover, .btn-retry:hover { background: var(--accent-deep); }
.btn-later {
  padding: 4px 12px; background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-secondary); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; margin-left: 8px;
}

.progress-wrap { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.progress-bar { flex: 1; height: 4px; background: var(--bg-input); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
.progress-text { font-size: 12px; color: var(--text-secondary); min-width: 36px; }

.install-hint { margin-top: 8px; font-size: 13px; color: var(--text-secondary); }
.error-hint { margin-top: 8px; font-size: 13px; color: var(--status-error); }

.force-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.force-dialog {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 28px; max-width: 420px; text-align: center;
}
.force-dialog h3 { font-size: 18px; color: var(--text-primary); margin-bottom: 12px; }
.force-dialog p { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.force-notes { font-size: 12px; color: var(--text-tertiary); max-height: 120px; overflow-y: auto; }
</style>
