import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import WelcomeView from '../views/WelcomeView.vue'
import HomeView from '../views/HomeView.vue'
import SettingsView from '../views/SettingsView.vue'
import NotchView from '../views/NotchView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', component: LoginView },
    { path: '/welcome', component: WelcomeView, meta: { requiresAuth: true } },
    { path: '/home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/settings', component: SettingsView },
    { path: '/notch', component: NotchView },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.loggedIn) {
    return '/login'
  }
  return true
})

export default router
