<script setup lang="ts">
import { computed } from 'vue'
import FileTabs from './FileTabs.vue'
import CodeEditor from './CodeEditor.vue'
import CodeDiffView from './CodeDiffView.vue'
import { useFilesStore } from '../../stores/files'

/** 编辑器区：文件 tab 条 + 互斥的「编辑器 / diff」两个视图。
 *  宿主有两处 —— 「文件」子页的 CodeView 与「终端」子页的分屏右栏。
 *  两处用同一个条件互斥渲染（HomeView 的 hostInSplit），保证同一时刻全应用
 *  只有一个实例：CodeEditor 用 `file:///${relPath}` 建 Monaco model，而 Monaco
 *  对同一 URI 只允许一个 model，两个实例会直接抛
 *  `Cannot add model because it already exists!`。 */
const store = useFilesStore()

/** 编辑器区显示 diff 还是文件。必须**恰好一个**为真 —— 用互斥的 computed 表达，
 *  而不是各自判断：一旦 activeView 取到意外值（例如热更新后 store 实例陈旧、
 *  没有 activeView 字段，`undefined === 'file'` 为假），两个 v-show 会同时隐藏，
 *  编辑器区整块空白（连「从左侧文件树选择文件」都不出现）。 */
const showDiff = computed(() => store.activeView === 'diff' && !!store.diffRequest)
const showEditor = computed(() => !showDiff.value)
</script>

<template>
  <section class="editor-panel">
    <!-- tab 栏常驻：diff 是并列的一个 tab，不能因为看 diff 就把文件 tab 藏掉 -->
    <FileTabs />
    <!-- 用 v-show 而非 v-if：保留两个组件实例，避免 Monaco 反复重建 -->
    <div v-show="showEditor" class="editor-slot">
      <CodeEditor />
    </div>
    <div v-show="showDiff" class="editor-slot">
      <CodeDiffView />
    </div>
  </section>
</template>

<style scoped>
.editor-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-slot {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
