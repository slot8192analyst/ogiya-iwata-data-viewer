<!-- src/components/home/FeatureCard.vue -->
<script setup lang="ts">
defineProps<{
  path: string
  label: string
  description: string
}>()
</script>

<template>
  <router-link :to="path" class="feature-card">
    <h3 class="feature-card__label">{{ label }}</h3>
    <p class="feature-card__description">{{ description }}</p>
  </router-link>
</template>

<style scoped>
.feature-card {
  display: block;
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s ease;
}

.feature-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.feature-card__label {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  color: #111827;
}

.feature-card__description {
  margin: 0;
  font-size: 0.85rem;
  color: #6b7280;
}
</style>
