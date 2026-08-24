import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
  { path: '/daily', name: 'daily', component: () => import('@/views/DailyView.vue') },
  { path: '/aim', name: 'aim', component: () => import('@/views/AimView.vue') },
  { path: '/analysis', name: 'analysis', component: () => import('@/views/AnalysisView.vue') },
  { path: '/calendar', name: 'calendar', component: () => import('@/views/CalendarView.vue') },
  { path: '/island', name: 'island', component: () => import('@/views/IslandView.vue') },
  { path: '/promotion', name: 'promotion', component: () => import('@/views/PromotionView.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
