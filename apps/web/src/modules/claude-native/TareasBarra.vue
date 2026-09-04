<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import type { ClaudeTask } from '@remotedevplus/protocol';

/**
 * Tareas en segundo plano.
 *
 * Es el grupo que se pasa por alto más fácil: un subagente o un comando en
 * background sobreviven al turno. El turno termina, la conversación queda
 * quieta, y el modelo se despierta más tarde con el resultado. Sin mostrarlas,
 * ese rato parece que no pasa nada.
 */
const props = defineProps<{ tasks: ClaudeTask[] }>();

const corriendo = computed(() => props.tasks.filter((t) => t.estado === 'corriendo'));
const terminadas = computed(() => props.tasks.filter((t) => t.estado !== 'corriendo'));

const icono = (estado: string) => ({
  corriendo: 'refresh', completed: 'chevron', failed: 'alert', stopped: 'close',
}[estado] ?? 'chevron');
</script>

<template>
  <div v-if="tasks.length" class="tareas">
    <p class="cabeza">
      <Icon name="claude" :size="12" />
      {{ corriendo.length ? `${corriendo.length} en segundo plano` : `${terminadas.length} tarea${terminadas.length > 1 ? 's' : ''} terminada${terminadas.length > 1 ? 's' : ''}` }}
    </p>

    <div v-for="t in [...corriendo, ...terminadas]" :key="t.id" class="fila" :class="t.estado">
      <Icon :name="icono(t.estado)" :size="12" :class="{ girando: t.estado === 'corriendo' }" />
      <span class="que">{{ t.resumen || t.descripcion }}</span>
      <span class="tipo">{{ t.tipo }}</span>
      <span v-if="t.tokens" class="uso">{{ (t.tokens / 1000).toFixed(1).replace('.', ',') }}k · {{ t.herramientas }} usos</span>
    </div>
  </div>
</template>

<style scoped>
.tareas {
  display: flex; flex-direction: column; gap: 3px;
  max-width: 54rem; padding: 9px 11px;
  border: 1px dashed var(--border-strong); border-radius: 9px;
}
.cabeza {
  display: flex; align-items: center; gap: 6px; margin: 0 0 2px;
  font-size: 11px; font-weight: 600; letter-spacing: .03em;
  text-transform: uppercase; color: var(--fg-faint);
}
.cabeza :deep(svg) { color: var(--accent); }

.fila { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; }
.fila :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); }
.fila.corriendo :deep(svg) { color: var(--accent); }
.fila.completed :deep(svg) { color: var(--ok); }
.fila.failed :deep(svg) { color: var(--danger); }

.girando { animation: girar 1.6s linear infinite; }
@keyframes girar { to { transform: rotate(1turn); } }
@media (prefers-reduced-motion: reduce) { .girando { animation: none; } }

.que { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-dim); }
.tipo {
  flex: 0 0 auto; padding: 0 6px; border-radius: 20px; background: var(--bg-surface);
  font: 10px var(--mono); color: var(--fg-faint);
}
.uso { flex: 0 0 auto; font: 10px var(--mono); color: var(--fg-faint); }
</style>
