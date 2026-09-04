<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import Markdown from './Markdown.vue';
import type { PermissionAsk } from './useClaudeSocket';

/**
 * El plan, en un modal.
 *
 * `ExitPlanMode` llega por `canUseTool` como cualquier herramienta, pero lo que
 * pide no es un permiso: es que alguien lea un documento y decida. Mostrarlo
 * como una tira de decisión al pie —o peor, como el JSON crudo de un permiso—
 * es tratar lo más importante de la conversación como un trámite.
 *
 * El plan viene entero en `input.plan`, así que no hace falta leer el archivo:
 * `planFilePath` se muestra como dato, no como enlace. Abrirlo obligaría a
 * agregar `~/.claude` a las raíces del usuario, que es ensanchar la frontera de
 * archivos para no ganar nada.
 */
const props = defineProps<{ ask: PermissionAsk }>();
const emit = defineEmits<{ (e: 'decide', allow: boolean): void }>();

const plan = computed(() => {
  const i = props.ask.input as any;
  return String(i?.plan ?? i?.content ?? '').trim();
});

const archivo = computed(() => (props.ask.input as any)?.planFilePath as string | undefined);
</script>

<template>
  <Teleport to="body">
    <!-- Sin cierre al tocar afuera: el turno de Claude está detenido esperando
         esta decisión, así que descartarla por accidente lo deja colgado. -->
    <div class="scrim">
      <div class="hoja" role="dialog" aria-modal="true" aria-label="Plan de Claude">
        <header>
          <Icon name="claude" :size="17" />
          <div class="titulo">
            <strong>Claude terminó de planificar</strong>
            <em v-if="archivo" :title="archivo">{{ archivo }}</em>
          </div>
        </header>

        <Markdown v-if="plan" class="cuerpo" :source="plan" />
        <pre v-else class="cuerpo crudo">{{ JSON.stringify(ask.input, null, 2) }}</pre>

        <footer>
          <button class="seguir" @click="emit('decide', false)">
            <strong>Seguir planificando</strong>
            <em>No cambia nada todavía</em>
          </button>
          <button class="aprobar" @click="emit('decide', true)">
            <strong>Aprobar y ejecutar</strong>
            <em>Sale del modo plan</em>
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 65;
  display: grid; place-items: center; padding: 1.5rem;
  padding-top: calc(1.5rem + var(--safe-t)); padding-bottom: calc(1.5rem + var(--safe-b));
  /* Sin backdrop-filter: rompe el hit-testing sobre el canvas WebGL del
     terminal en WebKit. Ver WorkspaceModal. */
  background: var(--scrim);
}
.hoja {
  display: flex; flex-direction: column;
  width: 100%; max-width: 56rem; max-height: 100%;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 15px; box-shadow: 0 26px 64px var(--shadow); overflow: hidden;
}

header {
  display: flex; align-items: flex-start; gap: 11px; flex: 0 0 auto;
  padding: 15px 18px; border-bottom: 1px solid var(--border);
}
header > :deep(svg) { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }
.titulo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.titulo strong { font-size: 14.5px; font-weight: 650; }
.titulo em {
  font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
  font: 10.5px var(--mono); color: var(--fg-faint);
}

.cuerpo {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: 20px 24px 26px;
  background: var(--bg);
  font-size: 14px;
}
.crudo { margin: 0; font: 12px/1.6 var(--mono); white-space: pre-wrap; }

footer {
  display: flex; gap: 8px; flex: 0 0 auto;
  padding: 13px 16px; border-top: 1px solid var(--border);
}
footer button {
  display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
  flex: 1 1 0; min-height: var(--touch); padding: 8px 14px; border-radius: 10px;
}
footer strong { font-size: 13px; font-weight: 600; }
footer em { font-style: normal; font-size: 10.5px; opacity: .75; }
.seguir { background: var(--bg-surface); border: 1px solid var(--border-strong); color: var(--fg-dim); }
.seguir:hover { border-color: var(--fg-faint); color: var(--fg); }
.aprobar { background: var(--accent); border: 1px solid var(--accent); color: var(--on-accent); }
@media (min-width: 40rem) {
  footer button { flex: 0 0 auto; min-width: 13rem; }
  footer { justify-content: flex-end; }
}
</style>
