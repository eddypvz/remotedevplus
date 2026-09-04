<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { ClaudeConversation, ClaudeHistoryEntry } from '@remotedevplus/protocol';
import { api } from '../../api';
import Icon from '../../ui/Icon.vue';
import Loading from '../../ui/Loading.vue';
import { useWorkspaces } from '../../stores/workspaces';
import { useDialogo } from '../../stores/dialogo';
import { useLauncher } from '../../stores/launcher';
import { useTabs } from '../../stores/tabs';
import { useLayout } from '../../stores/layout';

/**
 * Listado de conversaciones de Claude, en el sidebar.
 *
 * El icono del rail abre esto y no una conversación nueva: lo normal es querer
 * seguir una que ya existe, no empezar de cero. "Nueva" abre el diálogo de
 * carpeta como antes.
 *
 * Las que están abiertas ahora mismo se listan aparte de las guardadas: unas
 * tienen un proceso vivo detrás y otras son un archivo en disco.
 */
const workspaces = useWorkspaces();
const dialogo = useDialogo();
const launcher = useLauncher();
const tabs = useTabs();
const layout = useLayout();

const activas = ref<ClaudeConversation[]>([]);
const guardadas = ref<ClaudeHistoryEntry[]>([]);
const cargando = ref(true);
const filtro = ref('');
const renombrando = ref<string | null>(null);
const nuevoTitulo = ref('');
const error = ref('');

const carpetas = computed(() => workspaces.active?.folders ?? []);

const visibles = computed(() => {
  const t = filtro.value.trim().toLowerCase();
  if (!t) return guardadas.value;
  return guardadas.value.filter((s) => (
    s.title.toLowerCase().includes(t) || s.cwd.toLowerCase().includes(t)
  ));
});

/** El nombre corto de la carpeta, para ubicar la conversación de un vistazo. */
function carpeta(path: string) {
  const f = carpetas.value.find((x) => path === x.path || path.startsWith(x.path + '/'));
  return f?.name ?? path.split('/').filter(Boolean).pop() ?? path;
}

function cuando(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d < 7 ? `hace ${d} d` : new Date(ms).toLocaleDateString('es');
}

async function cargar() {
  if (!carpetas.value.length) { guardadas.value = []; cargando.value = false; return; }
  cargando.value = true;
  error.value = '';
  try {
    const params = carpetas.value.map((f) => `cwd=${encodeURIComponent(f.path)}`).join('&');
    const [h, a] = await Promise.all([
      api.get<{ sessions: ClaudeHistoryEntry[] }>(`/api/claude/history?${params}`),
      api.get<{ conversations: ClaudeConversation[] }>('/api/claude'),
    ]);
    guardadas.value = h.sessions;
    activas.value = a.conversations;
  } catch (e: any) {
    error.value = e?.message || 'No se pudieron leer las conversaciones';
  } finally {
    cargando.value = false;
  }
}

function nueva() {
  launcher.launch('claude-native');
}

function abrir(s: ClaudeHistoryEntry) {
  tabs.open('claude-native', {
    cwd: s.cwd,
    label: carpeta(s.cwd),
    resume: s.sessionId,
    title: s.title,
  });
}

function enfocar(c: ClaudeConversation) {
  const tab = tabs.list.find((t) => t.moduleId === 'claude-native' && t.ctx.conversationId === c.id);
  if (tab) tabs.activate(tab.key);
  else tabs.open('claude-native', { cwd: c.cwd, label: carpeta(c.cwd), conversationId: c.id });
}

function empezarRenombre(s: ClaudeHistoryEntry) {
  renombrando.value = s.sessionId;
  nuevoTitulo.value = s.title;
}

async function guardarRenombre(s: ClaudeHistoryEntry) {
  const t = nuevoTitulo.value.trim();
  renombrando.value = null;
  if (!t || t === s.title) return;
  try {
    await api.patch(`/api/claude/history/${s.sessionId}`, { title: t });
    s.title = t;
  } catch (e: any) {
    error.value = e?.message || 'No se pudo renombrar';
  }
}

/** Las pestañas que muestran esta conversación, sea reanudada o viva. */
function pestanasDe(sessionId: string) {
  const viva = activas.value.find((c) => c.sessionId === sessionId);
  return tabs.list.filter((t) => (
    t.moduleId === 'claude-native'
    && (t.ctx.resume === sessionId || (!!viva && t.ctx.conversationId === viva.id))
  ));
}

async function borrar(s: ClaudeHistoryEntry) {
  const viva = activas.value.find((c) => c.sessionId === s.sessionId);
  const abiertas = pestanasDe(s.sessionId);

  const ok = await dialogo.confirmar({
    titulo: 'Eliminar la conversación',
    mensaje: 'Se borra del historial de Claude Code en disco. No se puede deshacer.'
      + (viva ? ' Está abierta ahora mismo, así que su proceso también se detiene.' : '')
      + (abiertas.length ? ` Se cierra${abiertas.length > 1 ? 'n' : ''} ${abiertas.length} pestaña${abiertas.length > 1 ? 's' : ''}.` : ''),
    detalle: s.title,
    aceptar: 'Eliminar', peligroso: true,
  });
  if (!ok) return;

  try {
    // Primero el proceso: borrar el archivo de sesión mientras Claude sigue
    // escribiendo en él lo dejaría a medio camino y podría recrearlo.
    if (viva) await api.del(`/api/claude/${viva.id}`).catch(() => {});
    await api.del(`/api/claude/history/${s.sessionId}`);

    // Y después las pestañas: dejar abierta una conversación que ya no existe
    // solo produce un error al recargarla.
    for (const t of abiertas) tabs.close(t.key);

    guardadas.value = guardadas.value.filter((x) => x.sessionId !== s.sessionId);
    activas.value = activas.value.filter((c) => c.sessionId !== s.sessionId);
  } catch (e: any) {
    error.value = e?.message || 'No se pudo eliminar';
  }
}

onMounted(cargar);
watch(() => workspaces.activeId, cargar);

/**
 * Se recarga cada vez que el panel se muestra.
 *
 * Entre una apertura y otra pudo pasar cualquier cosa: una conversación nueva
 * desde otra pestaña, una borrada desde la terminal, un título que cambió. Un
 * listado viejo es peor que ninguno, porque parece actual.
 */
watch(
  () => layout.activePanel === 'claude' && layout.sidebarVisible,
  (visible) => { if (visible) cargar(); },
);
</script>

<template>
  <div class="panel">
    <div class="acciones">
      <button class="nueva" @click="nueva">
        <Icon name="plus" :size="15" /> Nueva conversación
      </button>
      <button class="refrescar" title="Actualizar" aria-label="Actualizar" @click="cargar">
        <Icon name="refresh" :size="15" />
      </button>
    </div>

    <label class="buscar">
      <Icon name="search" :size="14" />
      <input v-model="filtro" placeholder="Buscar conversaciones…" spellcheck="false">
    </label>

    <div class="lista rdp-scroll">
      <p v-if="error" class="err">{{ error }}</p>
      <Loading v-else-if="cargando" />

      <template v-else>
        <template v-if="activas.length">
          <p class="grupo">Abiertas · {{ activas.length }}</p>
          <button v-for="c in activas" :key="c.id" class="item viva" @click="enfocar(c)">
            <span class="punto" :class="c.state" />
            <span class="cuerpo">
              <span class="nm">{{ c.title }}</span>
              <span class="meta">{{ carpeta(c.cwd) }} · {{ c.state }}</span>
            </span>
          </button>
        </template>

        <p class="grupo">
          Guardadas<template v-if="visibles.length"> · {{ visibles.length }}</template>
        </p>

        <p v-if="!carpetas.length" class="nada">
          Abra un workspace para ver sus conversaciones.
        </p>
        <p v-else-if="!visibles.length" class="nada">
          {{ filtro ? 'Ninguna coincide con la búsqueda.' : 'Todavía no hay conversaciones en este workspace.' }}
        </p>

        <div v-for="s in visibles" :key="s.sessionId" class="fila">
          <input
            v-if="renombrando === s.sessionId"
            v-model="nuevoTitulo" class="renombre" autofocus
            @keydown.enter="guardarRenombre(s)"
            @keydown.escape="renombrando = null"
            @blur="guardarRenombre(s)"
          >
          <button v-else class="item" @click="abrir(s)">
            <Icon name="claude" :size="14" />
            <span class="cuerpo">
              <span class="nm">{{ s.title }}</span>
              <span class="meta">{{ carpeta(s.cwd) }} · {{ cuando(s.updatedAt) }}</span>
            </span>
          </button>

          <div v-if="renombrando !== s.sessionId" class="acts">
            <button title="Renombrar" aria-label="Renombrar" @click.stop="empezarRenombre(s)">
              <Icon name="settings" :size="13" />
            </button>
            <button title="Eliminar" aria-label="Eliminar" class="mal" @click.stop="borrar(s)">
              <Icon name="close" :size="13" />
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.acciones { display: flex; gap: 5px; flex: 0 0 auto; padding: 8px 8px 6px; }
.nueva {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  flex: 1; min-height: 34px; border-radius: 8px;
  background: var(--accent); color: var(--on-accent);
  font-size: 12.5px; font-weight: 600;
}
.refrescar {
  display: grid; place-items: center; width: 34px; flex: 0 0 34px;
  border-radius: 8px; border: 1px solid var(--border-strong); color: var(--fg-faint);
}
.refrescar:hover { color: var(--fg); background: var(--bg-hover); }

.buscar {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  margin: 0 8px 6px; padding: 0 9px; height: 30px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
}
.buscar :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); }
.buscar input { flex: 1; min-width: 0; border: 0; background: none; font-size: 12.5px; }
.buscar input:focus { outline: none; }

.lista { flex: 1; min-height: 0; padding: 0 6px 14px; }

.grupo {
  margin: 8px 6px 3px; font-size: 10.5px; font-weight: 600;
  letter-spacing: .06em; text-transform: uppercase; color: var(--fg-faint);
}

.fila { display: flex; align-items: center; gap: 2px; }

.item {
  display: flex; align-items: center; gap: 8px;
  flex: 1; min-width: 0; min-height: var(--touch);
  padding: 6px 8px; border-radius: 8px; text-align: left;
}
.item:hover { background: var(--bg-hover); }
.item > :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.cuerpo { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.nm {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; color: var(--fg);
}
.meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 10.5px; color: var(--fg-faint);
}

.punto {
  width: 7px; height: 7px; flex: 0 0 7px; margin: 0 4px; border-radius: 50%;
  background: var(--fg-faint);
}
.punto.pensando { background: var(--accent); animation: latir 1.2s ease-in-out infinite; }
.punto.inactiva { background: var(--ok); }
.punto.esperando-permiso { background: var(--warn); }
@keyframes latir { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .punto.pensando { animation: none; } }

/*
 * Los botones ocupan lugar en la fila en vez de flotar encima.
 *
 * Flotaban con `position: absolute` y tapaban la fecha ("hace 4 min"), que es
 * justo lo que uno lee para elegir una conversación. Reservar el ancho cuesta
 * unos píxeles de título y no tapa nada.
 */
.acts { display: flex; gap: 1px; flex: 0 0 auto; opacity: 0; transition: opacity .12s; }
.fila:hover .acts, .fila:focus-within .acts { opacity: 1; }
@media (pointer: coarse) { .acts { opacity: .55; } }
.acts button {
  display: grid; place-items: center; width: 26px; height: 26px;
  border-radius: 6px; color: var(--fg-faint);
}
.acts button:hover { background: var(--bg-active); color: var(--fg); }
.acts button.mal:hover { color: var(--danger); }

.renombre {
  flex: 1; min-width: 0; height: 34px; margin: 2px 0; padding: 0 9px;
  background: var(--bg); border: 1px solid var(--accent); border-radius: 8px;
  font-size: 12.5px;
}
.renombre:focus { outline: none; }

.nada { margin: 6px 8px; font-size: 12px; line-height: 1.6; color: var(--fg-faint); }
.err { margin: 10px 8px; font-size: 12px; color: var(--danger); }
</style>
