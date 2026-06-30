<template>
  <div class="modal-overlay" @click.self="onClose">
    <div class="permission-modal">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon">{{ isAskUserQuestion ? '?' : '⚠' }}</span>
          {{ isAskUserQuestion ? '需要你确认' : '工具执行请求' }}
        </div>
        <button class="modal-close" title="关闭" @click="onClose">×</button>
      </div>

      <!-- 普通工具授权 -->
      <template v-if="!isAskUserQuestion">
        <div class="modal-body">
          <div class="tool-name" :class="toolBadgeClass">{{ displayToolName }}</div>
          <div class="section-label">参数</div>
          <pre class="args-box"><code>{{ formattedToolInput }}</code></pre>
        </div>
        <div class="modal-footer">
          <button class="btn btn-deny" @click="onDeny">拒绝</button>
          <button class="btn btn-allow" @click="onAllow">允许</button>
        </div>
      </template>

      <!-- AskUserQuestion 向导 -->
      <template v-else>
        <div class="wizard-steps">
          <template v-for="(_, i) in questions" :key="i">
            <button
              class="wizard-step"
              :class="{ active: currentStep === i, answered: isAnswered(i) }"
              @click="currentStep = i"
            >{{ i + 1 }}</button>
            <span v-if="i < questions.length - 1" :key="`div-${i}`" class="wizard-step-divider"></span>
          </template>
        </div>

        <div class="wizard-body">
          <div class="wizard-question">
            <div class="question-meta">
              <span class="question-index">问题 {{ currentStep + 1 }} / {{ questions.length }}</span>
              <span class="question-type">{{ questionTypeText }}</span>
            </div>
            <div class="question-text">{{ currentQuestion.question }}</div>
            <div v-if="currentQuestion.options && currentQuestion.options.length > 0" class="options">
              <label
                v-for="(opt, idx) in currentQuestion.options"
                :key="idx"
                class="option"
                :class="{ selected: isSelected(idx) }"
              >
                <input
                  :type="currentQuestion.type === 'multiple' ? 'checkbox' : 'radio'"
                  :name="`q-${currentStep}`"
                  :checked="isSelected(idx)"
                  @change="toggleOption(idx)"
                >
                <span class="option-label">{{ optionLabel(opt) }}</span>
              </label>
            </div>
            <div class="custom-input" :class="{ full: !currentQuestion.options || currentQuestion.options.length === 0 }">
              <span v-if="currentQuestion.options && currentQuestion.options.length > 0" class="custom-input-label">其他 / 补充：</span>
              <input
                v-model="customInput[currentStep]"
                type="text"
                :placeholder="customPlaceholder"
              >
            </div>
          </div>
        </div>

        <div class="modal-footer has-prev">
          <button class="btn btn-deny" :disabled="currentStep === 0" @click="prevStep">上一题</button>
          <div class="footer-right">
            <button class="btn btn-deny" @click="onDeny">取消</button>
            <button
              v-if="isLastStep"
              class="btn btn-submit"
              :disabled="!allAnswered"
              @click="onSubmit"
            >提交</button>
            <button v-else class="btn btn-allow" :disabled="!isAnswered(currentStep)" @click="nextStep">下一题</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HookPermissionRequest } from '../stores/sessions'

const props = defineProps<{ request: HookPermissionRequest }>()
const emit = defineEmits<{
  (e: 'decision', decision: { behavior: string; updatedInput?: any; message?: string }): void
  (e: 'close'): void
}>()

const isAskUserQuestion = computed(() => props.request.toolName === 'AskUserQuestion')

// 普通工具
const displayToolName = computed(() => {
  const name = props.request.toolName || 'Unknown'
  return name
})

const toolBadgeClass = computed(() => {
  const name = props.request.toolName
  if (name === 'Bash') return 'bash'
  if (name === 'Read') return 'read'
  if (name === 'Write' || name === 'MultiEdit') return 'write'
  if (name === 'Edit') return 'edit'
  if (name === 'Glob' || name === 'Grep') return 'search'
  if (name === 'WebFetch' || name === 'WebSearch') return 'web'
  if (name === 'Skill') return 'skill'
  return 'default'
})

const formattedToolInput = computed(() => {
  try {
    return JSON.stringify(props.request.toolInput || {}, null, 2)
  } catch {
    return String(props.request.toolInput)
  }
})

function onAllow() {
  emit('decision', { behavior: 'allow' })
}

function onDeny() {
  emit('decision', { behavior: 'deny', message: 'user denied' })
}

function onClose() {
  if (isAskUserQuestion.value) {
    emit('decision', { behavior: 'deny', message: 'user closed' })
  } else {
    emit('decision', { behavior: 'deny', message: 'user closed' })
  }
  emit('close')
}

// AskUserQuestion
interface Question {
  raw: any
  question: string
  options?: any[]
  type?: 'single' | 'multiple' | 'text'
}

const rawQuestions = computed(() => {
  const input = props.request.toolInput || {}
  return input.questions || []
})

const questions = computed<Question[]>(() => rawQuestions.value.map((q: any) => normalizeQuestion(q)))

function normalizeQuestion(q: any): Question {
  const text = typeof q === 'string' ? q : q.question
  const rawOptions = q.options || []
  const opts = rawOptions.map((o: any) => (typeof o === 'string' ? { label: o } : o))
  const allowMultiple = !!q.multiSelect || !!q.allow_multiple || q.type === 'multiple'
  const hasOptions = opts.length > 0
  return {
    raw: q,
    question: text,
    options: opts,
    type: hasOptions ? (allowMultiple ? 'multiple' : 'single') : 'text',
  }
}

const currentStep = ref(0)
const selected = ref<Record<number, number[]>>({})
const customInput = ref<Record<number, string>>({})

watch(() => props.request.requestId, () => {
  currentStep.value = 0
  selected.value = {}
  customInput.value = {}
}, { immediate: true })

const currentQuestion = computed(() => questions.value[currentStep.value])
const isLastStep = computed(() => currentStep.value === questions.value.length - 1)

const questionTypeText = computed(() => {
  const t = currentQuestion.value.type
  if (t === 'multiple') return '多选'
  if (t === 'text') return '输入'
  return '单选'
})

const customPlaceholder = computed(() => {
  if (!currentQuestion.value.options || currentQuestion.value.options.length === 0) {
    return '请输入回答'
  }
  return '可手动输入补充内容'
})

function optionLabel(opt: any): string {
  if (!opt) return ''
  if (typeof opt === 'string') return opt
  return opt.label || opt.value || String(opt)
}

function isSelected(idx: number): boolean {
  return (selected.value[currentStep.value] || []).includes(idx)
}

function toggleOption(idx: number) {
  const list = selected.value[currentStep.value] || []
  if (currentQuestion.value.type === 'multiple') {
    if (list.includes(idx)) {
      selected.value = { ...selected.value, [currentStep.value]: list.filter((i) => i !== idx) }
    } else {
      selected.value = { ...selected.value, [currentStep.value]: [...list, idx] }
    }
  } else {
    selected.value = { ...selected.value, [currentStep.value]: [idx] }
  }
}

function isAnswered(step: number): boolean {
  const q = questions.value[step]
  if (!q) return false
  if (q.type === 'text') {
    return !!(customInput.value[step] || '').trim()
  }
  const hasSelection = (selected.value[step] || []).length > 0
  const hasCustom = !!(customInput.value[step] || '').trim()
  return hasSelection || hasCustom
}

const allAnswered = computed(() => questions.value.every((_, i) => isAnswered(i)))

function nextStep() {
  if (currentStep.value < questions.value.length - 1) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

function buildUpdatedInput() {
  const answers = rawQuestions.value.map((raw: any, i: number) => {
    const q = questions.value[i]
    const selIdx = selected.value[i] || []
    const selLabels = selIdx.map((idx) => optionLabel(q.options![idx]))
    const custom = (customInput.value[i] || '').trim()

    let answer: string | string[] = ''
    if (q.type === 'text') {
      answer = custom
    } else if (q.type === 'multiple') {
      answer = custom ? [...selLabels, custom] : selLabels
    } else {
      // 单选：优先使用手动输入，否则使用选中的选项
      answer = custom || selLabels[0] || ''
    }

    return { ...raw, answer }
  })
  return { questions: answers }
}

function onSubmit() {
  if (!allAnswered.value) return
  emit('decision', { behavior: 'allow', updatedInput: buildUpdatedInput() })
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(2px);
}
.permission-modal {
  width: 520px;
  max-width: 90vw;
  max-height: 90vh;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.modal-title .icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.modal-close {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}
.modal-close:hover { color: var(--text-primary); }
.modal-body {
  padding: 18px;
  overflow-y: auto;
}
.tool-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
}
.tool-name.bash { background: rgba(52, 211, 153, 0.12); color: #34d399; }
.tool-name.read { background: rgba(96, 165, 250, 0.12); color: #60a5fa; }
.tool-name.write { background: rgba(251, 191, 36, 0.12); color: #fbbf24; }
.tool-name.edit { background: rgba(251, 146, 60, 0.12); color: #fb923c; }
.tool-name.search { background: rgba(167, 139, 250, 0.12); color: #a78bfa; }
.tool-name.web { background: rgba(56, 189, 248, 0.12); color: #38bdf8; }
.tool-name.skill { background: rgba(139, 92, 246, 0.12); color: #c4b5fd; }
.tool-name.default { background: rgba(161, 161, 170, 0.12); color: var(--text-secondary); }
.section-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}
.args-box {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.modal-footer {
  padding: 14px 18px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}
.modal-footer.has-prev { justify-content: space-between; }
.footer-right { display: flex; gap: 10px; }
.btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s, transform 0.05s;
}
.btn:active { transform: scale(0.98); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-deny {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-primary);
}
.btn-deny:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); border-color: var(--text-tertiary); }
.btn-allow { background: var(--accent); color: white; }
.btn-allow:hover:not(:disabled) { background: var(--accent-light); }
.btn-submit { background: var(--accent); color: white; }
.btn-submit:hover:not(:disabled) { background: var(--accent-light); }

.wizard-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.wizard-step {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  background: var(--border);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  border: none;
}
.wizard-step:hover { background: var(--text-tertiary); color: var(--text-primary); }
.wizard-step.active { background: var(--accent); color: white; }
.wizard-step.answered { background: rgba(139, 92, 246, 0.2); color: var(--accent-light); border: 1px solid rgba(139, 92, 246, 0.4); }
.wizard-step-divider { width: 16px; height: 1px; background: var(--border); }
.wizard-body {
  padding: 20px;
  min-height: 220px;
  overflow-y: auto;
}
.wizard-question { animation: fadeIn 0.2s ease; }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.question-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.question-index {
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--border);
  padding: 2px 6px;
  border-radius: 4px;
}
.question-type { font-size: 10px; color: var(--text-tertiary); }
.question-text {
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 10px;
  line-height: 1.5;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  border: 1px solid transparent;
}
.option:hover { background: rgba(255, 255, 255, 0.04); }
.option.selected { background: rgba(139, 92, 246, 0.1); border-color: rgba(139, 92, 246, 0.3); }
.option input[type="radio"],
.option input[type="checkbox"] {
  margin-top: 2px;
  accent-color: var(--accent);
}
.option-label {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.custom-input {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.custom-input.full { margin-top: 6px; padding-top: 0; border-top: none; }
.custom-input-label {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}
.custom-input input[type="text"] {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 6px 10px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}
.custom-input input[type="text"]:focus { border-color: var(--accent); }
</style>
