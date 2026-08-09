import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    // 5180：避免与其他本地项目（如 WorkBuddy 的 vite 5173）冲突
    port: 5180,
    strictPort: true,
  },
})
