<script setup lang="ts">
import PtyTerminal from './PtyTerminal.vue';
defineProps<{ ctx: Record<string, unknown>; active: boolean }>();
</script>

<template>
  <PtyTerminal kind="shell" :ctx="ctx" :active="active" />
</template>
