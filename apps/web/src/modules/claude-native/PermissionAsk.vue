<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import type { PermissionAsk } from './useClaudeSocket';

/**
 * Autorización de una herramienta, encima de la caja de texto.
 *
 * Va ahí y no en medio del hilo porque bloquea: mientras esté abierta, el turno
 * de Claude está detenido esperando. Puesta junto al campo, está donde la vista
 * ya está y no hay que ir a buscarla scrolleando.
 *
 * Las opciones no son inventadas: `canUseTool` entrega `suggestions`, que son
 * las reglas que evitarían volver a preguntar lo mismo en esta sesión. Eso es
 * lo que hace posible el "permitir siempre".
 */
const props = defineProps<{ ask: PermissionAsk; cwd: string }>();
const emit = defineEmits<{ (e: 'decide', allow: boolean, updated?: unknown[]): void }>();

const rel = (p: string) => (p.startsWith(props.cwd + '/') ? p.slice(props.cwd.length + 1) : p);

/**
 * El bridge manda `title` con la frase ya armada casi siempre. Cuando no,
 * "Claude quiere usar EnterWorktree" no le dice nada a nadie, así que las
 * herramientas que cambian el contexto de trabajo llevan su propia frase.
 */
const FRASES: Record<string, string> = {
  EnterPlanMode: 'Claude quiere entrar en modo plan',
  ExitPlanMode: 'Claude quiere salir del modo plan',
  EnterWorktree: 'Claude quiere trabajar en un worktree de git aislado',
  ExitWorktree: 'Claude quiere salir del worktree y volver al repositorio',
  TodoWrite: 'Claude quiere actualizar su lista de tareas',
  Task: 'Claude quiere lanzar un subagente',
  Workflow: 'Claude quiere orquestar varios subagentes',
  Artifact: 'Claude quiere publicar una página',
  ReportFindings: 'Claude quiere reportar los hallazgos de una revisión',
};

const encabezado = computed(() => (
  props.ask.title
  || FRASES[props.ask.toolName]
  || `Claude quiere usar ${props.ask.displayName || props.ask.toolName}`
));

const detalle = computed(() => {
  const i = props.ask.input as any;
  if (i?.command) return String(i.command);
  if (i?.file_path) return rel(String(i.file_path));
  if (i?.url) return String(i.url);
  return JSON.stringify(i ?? {}, null, 2).slice(0, 800);
});

const puedeRecordar = computed(() => !!props.ask.suggestions?.length);
</script>

<template>
  <div class="ask">
    <header>
      <Icon name="alert" :size="15" />
      <span class="que">{{ encabezado }}</span>
    </header>

    <p v-if="ask.description" class="sub">{{ ask.description }}</p>
    <p v-if="ask.blockedPath" class="sub">
      Fuera de las carpetas permitidas: <code>{{ ask.blockedPath }}</code>
    </p>

    <pre>{{ detalle }}</pre>

    <div class="opciones">
      <button class="op no" @click="emit('decide', false)">
        <strong>Denegar</strong>
        <em>Claude sigue sin hacerlo</em>
      </button>
      <button class="op" @click="emit('decide', true)">
        <strong>Permitir una vez</strong>
        <em>Vuelve a preguntar la próxima</em>
      </button>
      <button v-if="puedeRecordar" class="op si" @click="emit('decide', true, ask.suggestions)">
        <strong>Permitir siempre</strong>
        <em>No pregunta más en esta conversación</em>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Igual que las preguntas: puede encogerse, para que un input grande no empuje
   al compositor fuera de la pantalla. */
.ask {
  display: flex; flex-direction: column; gap: 8px;
  flex: 0 1 auto; min-height: min(13rem, 40dvh); max-height: 55dvh; overflow-y: auto;
  padding: 11px 12px;
  background: color-mix(in oklab, var(--warn) 7%, var(--bg-panel));
  border-top: 1px solid var(--warn);
}
header { display: flex; align-items: center; gap: 8px; }
header :deep(svg) { flex: 0 0 auto; color: var(--warn); }
.que { font-size: 13px; font-weight: 600; }
.sub { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--fg-dim); }
.sub code { padding: .1em .35em; border-radius: 4px; background: var(--bg-surface); font: 11px var(--mono); }

pre {
  margin: 0; padding: 9px 11px; max-height: 11rem; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  font: 12px/1.55 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere;
}

/* Opciones apiladas con su consecuencia escrita: "permitir" y "permitir
   siempre" no significan lo mismo y la diferencia importa. */
.opciones { display: flex; flex-wrap: wrap; gap: 6px; }
.op {
  display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
  flex: 1 1 11rem; min-height: var(--touch); padding: 6px 11px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 9px; text-align: left;
}
.op strong { font-size: 12.5px; font-weight: 600; color: var(--fg); }
.op em { font-style: normal; font-size: 10.5px; color: var(--fg-faint); }
.op:hover { border-color: var(--accent); }
.op.no:hover { border-color: var(--danger); }
.op.no:hover strong { color: var(--danger); }
.op.si { background: var(--accent); border-color: var(--accent); }
.op.si strong { color: var(--on-accent); }
.op.si em { color: var(--on-accent); opacity: .75; }
</style>
