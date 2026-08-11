import './preload'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/reset.css'
import './styles/base.css'
import './styles/theme.css'

import { initTheme } from './composables/useTheme'
// 主题在 app 挂载前同步应用，避免闪烁；useTheme 内部解析 system 并监听变化
initTheme()

const app = createApp(App)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[lynel-desktop] Vue error:', info, err)
}
app.use(createPinia())
app.use(router)
app.mount('#app')
