<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { PtySession } from '@remotedevplus/protocol';
import Icon from '../../ui/Icon.vue';
import Loading from '../../ui/Loading.vue';
import { useTerminals } from '../../stores/terminals';
import { useWorkspaces } from '../../stores/workspaces';
import { useLauncher } from '../../stores/launcher';
import { useTabs } from '../../stores/tabs';
import { useDialogo } from '../../stores/dialogo';

/**
 * Las terminales abiertas, en el sidebar.
 *
 * Una terminal ya no es "la terminal de esta carpeta": se pueden tener varias
 * en el mismo directorio, y entonces hace falta un lugar donde verlas todas y
 * saltar entre ellas. El rail abre este listado y no una terminal nueva, por el
 * mismo motivo que el panel de Claude: lo normal es volver a una que ya existe.
 *
 * "Nueva" pasa por el diálogo de carpeta, igual que git: con un workspace de
 * varias carpetas, en cuál abrirla no es una pregunta que se pueda adivinar.
 */
const terminals = useTerminals();
const workspaces = useWorkspaces();
const launcher = useLauncher();
const tabs = useTabs();
const dialogo = useDialogo();

const cargando = ref(true);
const error = ref('');

const carpetas = computed(() => workspaces.active?.folders ?? []);

/** Vivas arriba: una terminal terminada es historia, no una herramienta. */
const vivas = computed(() => terminals.shells.filter((s) => s.alive));
const muertas = computed(() => terminals.shells.filter((s) => !s.alive));

/** La pestaña abierta de esta sesión, si la hay. */
const claveDe = (s: PtySession) => (
  tabs.list.find((t) => t.moduleId === 'terminal' && t.ctx.sessionId === s.id)?.key ?? null
);

const esActiva = (s: PtySession) => claveDe(s) !== null && tabs.activeKey === claveDe(s);

/** El nombre corto de la carpeta, para ubicar la terminal de un vistazo. */
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
  return `hace ${Math.round(h / 24)} d`;
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    await terminals.refresh();
  } catch (e: any) {
    error.value = e?.message || 'No se pudieron leer las terminales';
  } finally {
    cargando.value = false;
  }
}

function nueva() {
  launcher.launch('terminal');
}

async function cerrar(s: PtySession) {
  const ok = await dialogo.confirmar({
    titulo: s.alive ? 'Cerrar la terminal' : 'Quitar la terminal',
    mensaje: s.alive
      ? 'Se terminará el proceso. Lo que esté corriendo se detiene.'
      : 'Se quitará de la lista. El proceso ya había terminado.',
    detalle: s.cwd,
    aceptar: s.alive ? 'Cerrar' : 'Quitar',
    peligroso: s.alive,
  });
  if (!ok) return;
  await terminals.cerrar(s.id);
}

onMounted(cargar);
</script>

<template>
  <div class="panel">
    <div class="acciones">
      <button class="nueva" @click="nueva">
        <Icon name="plus" :size="15" /> Nueva terminal
      </button>
      <button class="refrescar" title="Actualizar" aria-label="Actualizar" @click="cargar">
        <Icon name="refresh" :size="15" />
      </button>
    </div>

    <div class="lista rdp-scroll">
      <p v-if="error" class="err">{{ error }}</p>
      <Loading v-else-if="cargando" />

      <template v-else>
        <p v-if="!terminals.shells.length" class="nada">
          No hay terminales abiertas. «Nueva terminal» pregunta en qué carpeta abrirla.
        </p>

        <template v-if="vivas.length">
          <p class="grupo">Abiertas · {{ vivas.length }}</p>
          <div v-for="s in vivas" :key="s.id" class="fila">
            <button class="item" :class="{ sel: esActiva(s) }" @click="terminals.mostrar(s)">
              <Icon name="terminal" :size="15" />
              <span class="cuerpo">
                <span class="nm">{{ carpeta(s.cwd) }}</span>
                <span class="meta">{{ s.cwd }} · {{ cuando(s.createdAt) }}</span>
              </span>
            </button>
            <span class="acts">
              <button class="mal" title="Cerrar la terminal" aria-label="Cerrar la terminal" @click="cerrar(s)">
                <Icon name="close" :size="14" />
              </button>
            </span>
          </div>
        </template>

        <template v-if="muertas.length">
          <p class="grupo">Terminadas · {{ muertas.length }}</p>
          <div v-for="s in muertas" :key="s.id" class="fila">
            <button class="item ida" @click="terminals.mostrar(s)">
              <Icon name="terminal" :size="15" />
              <span class="cuerpo">
                <span class="nm">{{ carpeta(s.cwd) }}</span>
                <span class="meta">terminada · {{ cuando(s.createdAt) }}</span>
              </span>
            </button>
            <span class="acts">
              <button class="mal" title="Quitar de la lista" aria-label="Quitar de la lista" @click="cerrar(s)">
                <Icon name="close" :size="14" />
              </button>
            </span>
          </div>
        </template>
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
.item.sel { background: var(--bg-active); }
.item > :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.item.ida > :deep(svg) { color: var(--fg-faint); }
.item.ida .nm { color: var(--fg-dim); }

.cuerpo { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.nm {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; color: var(--fg);
}
.meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 10.5px; color: var(--fg-faint);
}

/* Los botones ocupan lugar en la fila en vez de flotar: tapar la ruta es tapar
   justo lo que se lee para elegir. Mismo criterio que el panel de Claude. */
.acts { display: flex; gap: 1px; flex: 0 0 auto; opacity: 0; transition: opacity .12s; }
.fila:hover .acts, .fila:focus-within .acts { opacity: 1; }
@media (pointer: coarse) { .acts { opacity: .55; } }
.acts button {
  display: grid; place-items: center; width: 26px; height: 26px;
  border-radius: 6px; color: var(--fg-faint);
}
.acts button:hover { background: var(--bg-active); color: var(--fg); }
.acts button.mal:hover { color: var(--danger); }

.nada { margin: 10px 8px; font-size: 12px; line-height: 1.6; color: var(--fg-faint); }
.err { margin: 10px 8px; font-size: 12px; color: var(--danger); }
</style>
