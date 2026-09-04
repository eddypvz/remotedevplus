<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ icon?: string; title: string; hint?: string }>();
</script>

<template>
  <div class="empty">
    <Icon v-if="icon" :name="icon" :size="30" />
    <h2>{{ title }}</h2>
    <p v-if="hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; height: 100%; padding: 2rem; text-align: center; color: var(--fg-faint);
}
.empty h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--fg-dim); }
.empty p { margin: 0; max-width: 30rem; font-size: 13px; line-height: 1.6; }
</style>
