import './preload'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/reset.css'
import './styles/theme.css'

// 启动时应用保存的主题，避免闪烁；无保存时默认使用浅色红蓝主题
const saved = localStorage.getItem('lynel-desktop-theme')
document.documentElement.setAttribute('data-theme', saved || 'light-pro')

const app = createApp(App)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[lynel-desktop] Vue error:', info, err)
}
app.use(createPinia())
app.use(router)
app.mount('#app')
