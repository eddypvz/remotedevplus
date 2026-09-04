<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { CLAUDE_MODELS, CLAUDE_MODES } from '@remotedevplus/protocol';
import type { ClaudeHistoryEntry } from '@remotedevplus/protocol';
import { api, q } from '../../api';
import Icon from '../../ui/Icon.vue';
import Loading from '../../ui/Loading.vue';
import Composer from '../terminal/Composer.vue';
import PillMenu from '../../ui/PillMenu.vue';
import ChatMessage from './ChatMessage.vue';
import Markdown from './Markdown.vue';
import PermissionAsk from './PermissionAsk.vue';
import PlanAsk from './PlanAsk.vue';
import DocumentosModal from './DocumentosModal.vue';
import TareasBarra from './TareasBarra.vue';
import QuestionAsk from './QuestionAsk.vue';
import { useClaudeSocket } from './useClaudeSocket';
import { useFiles } from '../../stores/files';
import { useSettings } from '../../stores/settings';

/**
 * Claude Code con interfaz propia, sobre el Agent SDK.
 *
 * La diferencia con el módulo del terminal no es estética: acá llegan MENSAJES,
 * no bytes de pantalla. Por eso hay historial de verdad, los permisos son un
 * diálogo y el modelo se cambia en caliente — sobre una TUI nada de eso se
 * puede hacer desde afuera.
 */
const props = defineProps<{
  ctx: Record<string, unknown>;
  active: boolean;
  tabKey: string;
}>();

const files = useFiles();
const settings = useSettings();
const cwd = computed(() => (props.ctx.cwd as string) || files.defaultCwd);

const mensajes = shallowRef<any[]>([]);
const scroller = ref<HTMLDivElement>();
const arrancando = ref(true);
const fallo = ref('');
const historial = ref<ClaudeHistoryEntry[]>([]);
const menuAbierto = ref(false);
/** El usuario subió a leer: no hay que arrastrarlo al fondo con cada mensaje. */
const pegadoAbajo = ref(true);

/** Lo que Claude está escribiendo ahora mismo, antes de que llegue completo. */
const enVivo = ref('');
const docsAbierto = ref(false);

/**
 * Cuántos documentos hay: planes más archivos escritos.
 *
 * Se cuenta acá para que el botón sepa si tiene algo que mostrar sin montar el
 * modal. La derivación completa vive en el modal, que es quien la usa.
 */
const cuantosDocs = computed(() => {
  const escritura = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  const rutas = new Set<string>();
  let planes = 0;
  for (const m of mensajes.value) {
    const c = m?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'ExitPlanMode' && b.input?.plan) planes++;
      else if (escritura.has(b.name)) {
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (p) rutas.add(p);
      }
    }
  }
  return planes + rutas.size;
});

const socket = useClaudeSocket({
  onDelta: (texto) => {
    if (texto === null) { enVivo.value = ''; return; }
    enVivo.value += texto;
    if (pegadoAbajo.value) nextTick(alFondo);
  },
  onMessage: (m) => {
    // Si el agente devolviera el mensaje que acabamos de pintar de forma
    // optimista, reemplaza al local en vez de duplicarlo. Hoy no lo devuelve,
    // pero depender de eso sería frágil.
    const ultimo = mensajes.value[mensajes.value.length - 1];
    if (ultimo?.local && m.type === 'user' && textoDe(m) === textoDe(ultimo)) {
      mensajes.value = [...mensajes.value.slice(0, -1), m];
    } else {
      mensajes.value = [...mensajes.value, m];
    }
    if (pegadoAbajo.value) nextTick(alFondo);
  },
  onReset: () => { mensajes.value = []; enVivo.value = ''; },
});

function textoDe(m: any): string {
  const c = m?.message?.content;
  if (typeof c === 'string') return c.trim();
  if (!Array.isArray(c)) return '';
  return c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
}

const conv = computed(() => socket.conversation.value);
const pensando = computed(() => conv.value?.state === 'pensando');

/**
 * Con el modelo en "el del sistema" no sirve mostrar eso: no dice nada. Se
 * muestra el que realmente quedó corriendo, que el SDK reporta como
 * `claude-opus-5` y acá se acorta a "Opus 5".
 */
const modeloVisible = computed(() => {
  const real = conv.value?.actualModel;
  if (!real) return 'Modelo';
  // El id puede traer sufijos entre corchetes, como claude-opus-5[1m] para la
  // variante de contexto largo. En la píldora estorban; van al tooltip.
  const limpio = real.replace(/^claude-/, '').replace(/\[.*$/, '');
  const partes = limpio.split('-').filter(Boolean);
  const familia = partes[0].charAt(0).toUpperCase() + partes[0].slice(1);
  const version = partes.slice(1).filter((x) => /^\d/.test(x)).join('.');
  return version ? `${familia} ${version}` : familia;
});

function alFondo() {
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/**
 * Baja al final y se queda ahí mientras el contenido termina de acomodarse.
 *
 * Un `scrollTop = scrollHeight` de una sola vez no alcanza al abrir una
 * conversación larga: el markdown se pinta, los bloques de código cambian de
 * alto y las fuentes cargan DESPUÉS de ese primer intento, así que el fondo se
 * corre y queda arriba. Se vuelve a anclar en cada cuadro hasta que la altura
 * deja de crecer, con un tope de tiempo para no quedar girando.
 */
async function anclarAbajo(msTope = 1200) {
  await nextTick();
  const hasta = Date.now() + msTope;
  let anterior = -1;
  return new Promise<void>((listo) => {
    const paso = () => {
      const el = scroller.value;
      if (!el) { listo(); return; }
      el.scrollTop = el.scrollHeight;
      const estable = el.scrollHeight === anterior;
      anterior = el.scrollHeight;
      if (estable || Date.now() > hasta) { listo(); return; }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  });
}

function alDesplazar() {
  const el = scroller.value;
  if (!el) return;
  pegadoAbajo.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

async function abrir(resume?: string) {
  arrancando.value = true;
  fallo.value = '';
  mensajes.value = [];
  try {
    // Si la pestaña ya tenía una conversación viva —se recargó la página, o se
    // la enfocó desde el panel— hay que reengancharla, no abrir otra: crear una
    // nueva dejaría el proceso anterior corriendo sin nadie mirando.
    const yaAbierta = props.ctx.conversationId as string | undefined;
    if (yaAbierta) {
      const vivas = await api.get<{ conversations: any[] }>('/api/claude')
        .then((r) => r.conversations).catch(() => []);
      const c = vivas.find((x) => x.id === yaAbierta);
      if (c) {
        if (c.sessionId) await cargarDesdeDisco(c.sessionId);
        socket.connect(c.id);
        // El indicador de carga se quita acá: mientras está, el contenedor del
        // hilo no existe y no hay nada que desplazar.
        arrancando.value = false;
        pegadoAbajo.value = true;
        await anclarAbajo();
        return;
      }
      delete props.ctx.conversationId;
    }

    const c = await api.post<any>('/api/claude', {
      cwd: cwd.value,
      model: (props.ctx.model as string) ?? 'default',
      permissionMode: (props.ctx.permissionMode as string) ?? 'default',
      resume,
    });
    props.ctx.conversationId = c.id;
    // Al reanudar, el historial se lee del disco: el buffer en memoria del
    // agente arranca vacío y solo trae lo nuevo.
    if (resume) await cargarDesdeDisco(resume);
    socket.connect(c.id);
    arrancando.value = false;
    pegadoAbajo.value = true;
    await anclarAbajo();
  } catch (e: any) {
    fallo.value = e?.message || 'No se pudo abrir la conversación';
  } finally {
    arrancando.value = false;
  }
}

async function cargarDesdeDisco(sessionId: string) {
  const r = await api.get<{ messages: any[] }>(`/api/claude/history/${sessionId}`)
    .catch(() => ({ messages: [] }));
  mensajes.value = r.messages;
}

async function cargarHistorial() {
  historial.value = await api.get<{ sessions: ClaudeHistoryEntry[] }>(
    `/api/claude/history?cwd=${q(cwd.value)}`,
  ).then((r) => r.sessions).catch(() => []);
}

/**
 * El mensaje del usuario se pinta al instante, sin esperar al agente.
 *
 * El SDK no devuelve el mensaje propio en el flujo, así que esperar a que
 * "llegue" dejaba la burbuja invisible hasta recargar. Y aunque lo devolviera,
 * ver lo que uno acaba de escribir no debería depender de una ida y vuelta.
 */
function enviar(texto: string) {
  mensajes.value = [...mensajes.value, {
    type: 'user',
    local: true,
    message: { role: 'user', content: [{ type: 'text', text: texto }] },
  }];
  socket.sendText(texto);
  pegadoAbajo.value = true;
  nextTick(alFondo);
}

/**
 * Tres herramientas se muestran distinto porque lo que piden es distinto: una
 * pregunta se contesta, un plan se lee y se aprueba, y un permiso se concede.
 * El resto cae en el permiso genérico.
 */
const preguntas = computed(() => socket.pending.value.filter((p) => p.toolName === 'AskUserQuestion'));
const planes = computed(() => socket.pending.value.filter((p) => p.toolName === 'ExitPlanMode'));
const permisos = computed(() => socket.pending.value.filter(
  (p) => p.toolName !== 'AskUserQuestion' && p.toolName !== 'ExitPlanMode',
));

/** Miles con una decimal: "12,4k" ocupa lo mismo que un número y se lee igual. */
function miles(n: number) {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace('.', ',') + 'k';
}

const medidor = computed(() => {
  const t = conv.value?.tokens;
  if (!t) return null;
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  if (!total) return null;
  return {
    total: miles(total),
    costo: (conv.value?.costUsd ?? 0).toFixed(2),
    detalle: `entrada ${miles(t.input)} · salida ${miles(t.output)}`
      + ` · caché leído ${miles(t.cacheRead)} · caché escrito ${miles(t.cacheWrite)}`
      + `\nAcumulado de la conversación. Es una estimación del SDK, no una factura.`,
  };
});

function responder(id: string, ask: any, answers: Record<string, string>) {
  // Las respuestas vuelven dentro del input de la herramienta, que es como
  // AskUserQuestion espera recibirlas.
  socket.decide(id, true, { updatedInput: { ...(ask.input ?? {}), answers } });
}

async function reanudar(s: ClaudeHistoryEntry) {
  menuAbierto.value = false;
  await abrir(s.sessionId);
}

async function nueva() {
  menuAbierto.value = false;
  await abrir();
}

function onVisible() {
  if (document.visibilityState === 'visible') socket.wake();
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisible);
  await abrir(props.ctx.resume as string | undefined);
  cargarHistorial();
});

watch(() => props.active, (a) => { if (a && pegadoAbajo.value) anclarAbajo(300); });

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible);
  socket.dispose();
});
</script>

<template>
  <div class="chat" :style="{ fontSize: settings.fontSize + 'px' }">
    <header class="bar">
      <Icon name="claude" :size="15" />
      <span class="title">{{ (props.ctx.title as string) || conv?.title || 'Claude Code' }}</span>

      <div class="menu">
        <button class="act" title="Conversaciones" @click="menuAbierto = !menuAbierto; menuAbierto && cargarHistorial()">
          <Icon name="refresh" :size="15" />
        </button>
        <div v-if="menuAbierto" class="drop">
          <button class="nueva" @click="nueva"><Icon name="plus" :size="14" /> Conversación nueva</button>
          <p v-if="!historial.length" class="nada">No hay conversaciones anteriores en esta carpeta.</p>
          <button v-for="s in historial" :key="s.sessionId" class="item" @click="reanudar(s)">
            <span class="nm">{{ s.title }}</span>
            <span class="fecha">{{ new Date(s.updatedAt).toLocaleString('es') }}</span>
          </button>
        </div>
      </div>
    </header>

    <Loading v-if="arrancando" />

    <div v-else ref="scroller" class="hilo rdp-scroll" @scroll="alDesplazar">
      <p v-if="fallo" class="fallo">{{ fallo }}</p>

      <p v-else-if="!mensajes.length" class="vacio">
        Conversación nueva en <code>{{ cwd }}</code>.
        Todo lo que se hable acá queda guardado y se puede reanudar después.
      </p>

      <ChatMessage v-for="(m, i) in mensajes" :key="i" :msg="m" :cwd="cwd" />


      <!-- El texto en vivo se pinta como markdown igual que el definitivo, para
           que no salte de aspecto cuando llega completo. -->
      <div v-if="enVivo" class="msg">
        <Markdown :source="enVivo" />
      </div>

      <TareasBarra v-if="socket.tasks.value.length" :tasks="socket.tasks.value" />

      <div v-if="pensando && !enVivo" class="pensando"><span /><span /><span /></div>
    </div>

    <DocumentosModal
      v-if="docsAbierto"
      :mensajes="mensajes" :cwd="cwd"
      @cerrar="docsAbierto = false"
    />

    <PlanAsk
      v-for="p in planes" :key="p.id"
      :ask="p"
      @decide="(allow) => socket.decide(p.id, allow)"
    />

    <QuestionAsk
      v-for="p in preguntas" :key="p.id"
      :ask="p"
      @answer="(answers) => responder(p.id, p, answers)"
      @cancel="socket.decide(p.id, false)"
    />

    <PermissionAsk
      v-for="p in permisos" :key="p.id"
      :ask="p" :cwd="cwd"
      @decide="(allow, updated) => socket.decide(p.id, allow, updated ? { updatedPermissions: updated as unknown[] } : undefined)"
    />

    <p v-if="socket.error.value" class="fallo abajo">{{ socket.error.value }}</p>
    <p v-else-if="socket.status.value === 'reconectando'" class="aviso">reconectando…</p>

    <Composer
      :tab-key="props.tabKey"
      :cwd="cwd"
      :disabled="arrancando || !!fallo || socket.status.value === 'error'"
      placeholder="Escriba aquí. Enter envía, Shift+Enter salta de línea."
      @send="enviar"
    >
      <!--
        Modelo y modo van acá abajo, junto al campo, y no en una cabecera
        arriba: es donde está la mano y donde están en el plugin de VS Code.
      -->
      <template #tools>
        <button
          class="docs" :class="{ on: docsAbierto }"
          :disabled="!cuantosDocs" :title="cuantosDocs ? 'Planes y archivos de esta conversación' : 'Todavía no hay planes ni archivos'"
          @click="docsAbierto = true"
        >
          <Icon name="file" :size="13" />
          {{ cuantosDocs || '—' }}
        </button>
        <PillMenu
          label="Modo de permisos" icon="bolt"
          :model-value="conv?.permissionMode ?? 'default'"
          :options="CLAUDE_MODES" :disabled="!conv"
          @update:model-value="(v) => socket.set({ permissionMode: v })"
        />
        <PillMenu
          label="Modelo"
          :model-value="conv?.model ?? 'default'"
          :options="CLAUDE_MODELS" :fallback-label="modeloVisible" :disabled="!conv"
          @update:model-value="(v) => socket.set({ model: v })"
        />
        <button v-if="pensando" class="detener" @click="socket.interrupt()">detener</button>

        <span v-if="medidor" class="medidor" :title="medidor.detalle">
          <span v-if="conv?.thinkingTokens" class="pensando-tk">
            +{{ miles(conv.thinkingTokens) }}
          </span>
          {{ medidor.total }} tk
          <em>${{ medidor.costo }}</em>
        </span>
      </template>
    </Composer>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; flex: 1; min-height: 0; }

/* Sin overflow: el menú de conversaciones se posiciona en absoluto dentro de
   esta barra, y un ancestro con overflow lo recortaría. */
.bar {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 6px 10px; min-width: 0;
  background: var(--bg-panel); border-bottom: 1px solid var(--border);
}
.bar > :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.title {
  flex: 1; min-width: 4rem; overflow: hidden; text-overflow: ellipsis;
  font-size: 12.5px; font-weight: 600;
}
:deep(.docs) {
  display: flex; align-items: center; gap: 5px; flex: 0 0 auto;
  height: 32px; padding: 0 10px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 9px; font-size: 12px; color: var(--fg-dim);
}
:deep(.docs:hover:not(:disabled)), :deep(.docs.on) { color: var(--fg); border-color: var(--accent); }
:deep(.docs > svg) { color: var(--accent); }
:deep(.docs:disabled) { opacity: .45; cursor: default; }
:deep(.docs:disabled > svg) { color: var(--fg-faint); }

:deep(.medidor) {
  /* Sin margin-left:auto: el botón de enviar ya lo usa para irse a la derecha,
     y dos autos se reparten el espacio y dejan el medidor flotando al medio. */
  display: flex; align-items: center; gap: 5px; flex: 0 0 auto;
  padding: 0 4px;
  font: 11px var(--mono); color: var(--fg-faint); white-space: nowrap;
  cursor: help;
}
:deep(.medidor em) { font-style: normal; opacity: .8; }
/* Lo que está pensando ahora mismo, que es lo único que el SDK reporta en vivo. */
:deep(.pensando-tk) {
  padding: 1px 5px; border-radius: 20px;
  background: color-mix(in oklab, var(--accent) 16%, transparent);
  color: var(--accent);
}

:deep(.detener) {
  flex: 0 0 auto; height: 32px; padding: 0 12px; border-radius: 9px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  font-size: 12px; color: var(--fg-dim);
}
:deep(.detener:hover) { color: var(--danger); border-color: var(--danger); }
.act {
  display: grid; place-items: center; width: 28px; height: 27px;
  border-radius: 7px; color: var(--fg-faint);
}
.act:hover { background: var(--bg-hover); color: var(--fg); }

.menu { position: relative; flex: 0 0 auto; }
.drop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 5;
  display: flex; flex-direction: column; gap: 2px;
  width: min(24rem, 80vw); max-height: 60dvh; overflow: auto; padding: 5px;
  background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: 10px; box-shadow: 0 14px 36px var(--shadow);
}
.drop .nueva, .drop .item {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 10px; border-radius: 7px; text-align: left; font-size: 12.5px;
}
.drop .nueva { color: var(--accent); font-weight: 550; border-bottom: 1px solid var(--border); border-radius: 7px 7px 0 0; }
.drop .item { flex-direction: column; align-items: flex-start; gap: 2px; }
.drop .nueva:hover, .drop .item:hover { background: var(--bg-hover); }
.drop .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; color: var(--fg); }
.drop .fecha { font-size: 10.5px; color: var(--fg-faint); }
.nada { margin: 0; padding: 10px; font-size: 12px; color: var(--fg-faint); }

.hilo {
  display: flex; flex-direction: column; gap: 18px;
  /* Cede todo el espacio que haga falta cuando aparece un panel de preguntas.
     Tiene scroll propio, así que achicarse no le duele; el que necesita alto
     mínimo es el panel, que es donde hay que leer y elegir. */
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; padding: 20px 20px 28px;
}
.vacio { margin: auto; max-width: 34rem; text-align: center; line-height: 1.7; color: var(--fg-faint); }
.vacio code { padding: .1em .4em; border-radius: 4px; background: var(--bg-surface); font: 11.5px var(--mono); }

.msg { max-width: 54rem; }

.pensando { display: flex; align-items: center; gap: 5px; }
.pensando span {
  width: 5px; height: 5px; border-radius: 50%; background: var(--fg-faint);
  animation: latir 1.1s ease-in-out infinite;
}
.pensando span:nth-child(2) { animation-delay: .15s; }
.pensando span:nth-child(3) { animation-delay: .3s; }
@keyframes latir { 0%, 60%, 100% { opacity: .25; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pensando span { animation: none; opacity: .6; } }

.fallo { margin: 0; padding: 10px 14px; font-size: 12.5px; color: var(--danger); }
.fallo.abajo, .aviso {
  flex: 0 0 auto; padding: 5px 12px;
  background: var(--bg-surface); border-top: 1px solid var(--border);
}
.aviso { margin: 0; font-size: 11.5px; color: var(--fg-dim); }
</style>
