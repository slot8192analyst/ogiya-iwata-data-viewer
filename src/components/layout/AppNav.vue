<!-- src/components/layout/AppNav.vue -->
<script setup lang="ts">
import { navItems } from '@/lib/navigation'
</script>

<template>
  <nav class="app-nav">
    <router-link
      v-for="item in navItems"
      :key="item.path"
      :to="item.path"
      class="app-nav__link"
      active-class="app-nav__link--active"
    >
      {{ item.label }}
    </router-link>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  overflow-x: auto;
  background-color: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
}

.app-nav__link {
  padding: 0.6rem 1rem;
  white-space: nowrap;
  color: #374151;
  text-decoration: none;
  font-size: 0.9rem;
}

.app-nav__link--active {
  color: #2563eb;
  font-weight: 600;
  border-bottom: 2px solid #2563eb;
}
</style>
