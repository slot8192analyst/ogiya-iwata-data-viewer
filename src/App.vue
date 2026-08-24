<!-- src/App.vue -->
<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
import AppNav from '@/components/layout/AppNav.vue'
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <AppNav />
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  padding: 1rem;
}
</style>
