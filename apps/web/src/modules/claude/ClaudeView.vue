<script setup lang="ts">
// Claude Code en un terminal, sin agregados. El cliente con interfaz propia
// —historial, selector de modelo, permisos como diálogo— es el módulo
// `claude-native`, que usa el Agent SDK en vez de una TUI.
import PtyTerminal from '../terminal/PtyTerminal.vue';
defineProps<{ ctx: Record<string, unknown>; active: boolean }>();
</script>

<template>
  <PtyTerminal kind="claude" :ctx="ctx" :active="active" />
</template>
