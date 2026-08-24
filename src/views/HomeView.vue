<!-- src/views/HomeView.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import FeatureCard from '@/components/home/FeatureCard.vue'
import { navItems } from '@/lib/navigation'

const now = new Date()

const greeting = computed(() => {
  const hour = now.getHours()
  if (hour < 5) return '深夜の稼働チェック、お疲れさまです'
  if (hour < 12) return 'おはようございます'
  if (hour < 18) return 'こんにちは'
  return 'こんばんは'
})

// ホーム自身へのリンクはカードに出さない
const featureCards = computed(() => navItems.filter((item) => item.path !== '/'))
</script>

<template>
  <section class="home-view">
    <p class="home-view__greeting">{{ greeting }}。今日も気になる台をチェックしましょう。</p>

    <div class="home-view__grid">
      <FeatureCard
        v-for="item in featureCards"
        :key="item.path"
        :path="item.path"
        :label="item.label"
        :description="item.description"
      />
    </div>
  </section>
</template>

<style scoped>
.home-view__greeting {
  margin-bottom: 1rem;
  color: #374151;
}

.home-view__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}
</style>
