<script setup lang="ts">
import { ref } from 'vue';

/**
 * Barra de teclas accesorias. No es un extra: **el teclado del iPad no tiene
 * Esc**, y Claude Code depende de Esc para interrumpir y de Shift+Tab para
 * cambiar de modo. Sin esta barra, Claude Code es inusable en tablet — que es
 * exactamente el problema que este proyecto existe para resolver.
 */
const emit = defineEmits<{ (e: 'send', data: string): void; (e: 'ctrl', on: boolean): void }>();

const ctrlOn = ref(false);

function toggleCtrl() {
  ctrlOn.value = !ctrlOn.value;
  emit('ctrl', ctrlOn.value);
}

/** El padre avisa cuando ya consumió el Ctrl pegajoso con la siguiente tecla. */
function clearCtrl() {
  ctrlOn.value = false;
}
defineExpose({ clearCtrl });

const keys = [
  { label: 'esc', data: '\x1b', wide: true },
  { label: 'tab', data: '\t' },
  { label: '⇧tab', data: '\x1b[Z' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '/', data: '/' },
  { label: '^C', data: '\x03' },
  { label: '^D', data: '\x04' },
];
</script>

<template>
  <div class="keys rdp-scroll" role="toolbar" aria-label="Teclas para el terminal">
    <button class="key mod" :class="{ on: ctrlOn }" :aria-pressed="ctrlOn" @click="toggleCtrl">
      ctrl
    </button>
    <button
      v-for="k in keys" :key="k.label"
      class="key" :class="{ wide: k.wide }"
      @click="emit('send', k.data)"
    >
      {{ k.label }}
    </button>
  </div>
</template>

<style scoped>
.keys {
  display: flex; align-items: center; gap: 5px;
  flex: 0 0 auto;
  padding: 6px 8px calc(6px + var(--safe-b));
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  overflow-x: auto; scrollbar-width: none;
}
.keys::-webkit-scrollbar { height: 0; }

.key {
  flex: 0 0 auto;
  min-width: 40px; height: 34px;
  padding: 0 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  color: var(--fg-dim);
  font: 500 13px/1 var(--mono);
  /* El tap no debe seleccionar texto ni disparar el menú de iOS. */
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
.key:active { background: var(--bg-active); color: var(--fg); transform: translateY(1px); }
.key.wide { min-width: 52px; }
.key.mod.on { background: var(--accent-soft); border-color: var(--accent); color: var(--on-accent); }
</style>
