<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import Icon from '../../ui/Icon.vue';
import Loading from '../../ui/Loading.vue';
import Empty from '../../ui/Empty.vue';
import GrafoCommits from './GrafoCommits.vue';
import PanelCambios from './PanelCambios.vue';
import PanelStash from './PanelStash.vue';
import DiffVista from './DiffVista.vue';
import DetalleCommit from './DetalleCommit.vue';
import { api, q } from '../../api';
import { useGit } from '../../stores/git';
import { useDialogo } from '../../stores/dialogo';
import { useFiles } from '../../stores/files';

/**
 * El gestor de git, a pantalla completa.
 *
 * Es la razón de existir del proyecto: en VS Code esto vive en una columna
 * angosta donde el árbol no entra y las acciones se esconden detrás del hover.
 * Acá el árbol ocupa el espacio principal y las tres cubetas de trabajo están
 * siempre a la vista, con sus botones puestos.
 */
const props = defineProps<{ ctx: Record<string, unknown>; active: boolean }>();

const git = useGit();
const dialogo = useDialogo();
const files = useFiles();

const carpeta = computed(() => (props.ctx.cwd as string) || files.defaultCwd);
const seleccionado = ref<string | null>(null);
const lado = ref<'cambios' | 'stash'>('cambios');
/** En angosto no caben árbol y panel a la vez. */
const vista = ref<'arbol' | 'trabajo'>('trabajo');
const diff = ref<{ ruta: string; texto: string; preparado: boolean; commit?: string } | null>(null);


/** El diff de un archivo tal como quedó en un commit. */
async function verDiffCommit(hash: string, ruta: string) {
  try {
    const r = await api.get<{ diff: string }>(
      `/api/git/commit/diff?cwd=${q(git.cwd!)}&hash=${hash}&path=${q(ruta)}`,
    );
    diff.value = { ruta, texto: r.diff, preparado: false, commit: hash };
  } catch {
    diff.value = { ruta, texto: '', preparado: false, commit: hash };
  }
}

async function verDiff(ruta: string, preparado: boolean) {
  try {
    const r = await git.diff(ruta, preparado);
    diff.value = { ruta, texto: r.diff, preparado };
  } catch {
    diff.value = { ruta, texto: '', preparado };
  }
}

const ocupado = ref(false);

/**
 * Envuelve una operación: bloquea los botones y muestra el error tal como lo
 * dio git. Sus mensajes son útiles —dicen qué archivo estorba, qué rama
 * divergió— y resumirlos a "falló" sería perder lo único accionable.
 */
async function hacer(titulo: string, fn: () => Promise<unknown>, recargarTodo = true) {
  ocupado.value = true;
  try {
    await fn();
    if (recargarTodo) await git.cargar(carpeta.value, true);
  } catch (e: any) {
    await dialogo.avisar({
      titulo: `${titulo} no se pudo completar`,
      detalle: e?.message || 'Error desconocido',
      peligroso: true,
    });
  } finally {
    ocupado.value = false;
  }
}

async function bajar() {
  await hacer('El pull', async () => {
    try {
      await git.bajar(false);
    } catch (e: any) {
      // El avance rápido falla cuando divergió; ahí sí vale preguntar.
      if (!/diverg|not possible to fast-forward|Not possible/i.test(e?.message ?? '')) throw e;
      const rebase = await dialogo.confirmar({
        titulo: 'El branch divergió del remoto',
        mensaje: 'No se puede hacer pull con fast-forward. ¿Hacer rebase de los commits '
          + 'locales encima de los del remoto?',
        detalle: e.message,
        aceptar: 'Hacer rebase',
      });
      if (rebase) await git.bajar(true);
    }
  });
}

async function situarse(ref: string) {
  const ok = await dialogo.confirmar({
    titulo: 'Hacer checkout de este punto',
    mensaje: 'Cambia el árbol de trabajo. Los cambios sin commit se conservan; '
      + 'si estorban, git lo va a decir.',
    detalle: ref.slice(0, 12),
    aceptar: 'Hacer checkout',
  });
  if (!ok) return;
  await hacer('El checkout', async () => {
    const r: any = await git.situarse(ref);
    seleccionado.value = null;
    if (r?.desprendido) {
      await dialogo.avisar({
        titulo: 'Quedó en detached HEAD',
        mensaje: 'Este commit no tiene un branch local apuntándole. Los commits que haga '
          + 'aquí se pierden al cambiar de branch, salvo que cree uno antes.',
      });
    }
  });
}

async function reordenar(sobre: string) {
  const ok = await dialogo.confirmar({
    titulo: 'Hacer rebase del branch',
    mensaje: `Los commits de "${git.estado?.rama}" se reescriben encima de este punto. `
      + 'Si ya se hizo push, el próximo va a necesitar force.',
    detalle: sobre.slice(0, 12),
    aceptar: 'Hacer rebase', peligroso: true,
  });
  if (ok) await hacer('El rebase', () => git.reordenar(sobre));
}

async function crearRama() {
  const nombre = nuevaRama.value.trim();
  if (!nombre) { pidiendoRama.value = true; return; }
  pidiendoRama.value = false;
  nuevaRama.value = '';
  await hacer('Crear el branch', () => git.cambiarRama(nombre, true));
}

const pidiendoRama = ref(false);
const nuevaRama = ref('');

onMounted(() => git.cargar(carpeta.value, true));
watch(carpeta, (c) => git.cargar(c, true));
watch(() => props.active, (a) => { if (a && git.cwd) git.cargar(git.cwd, false); });
</script>

<template>
  <div class="git">
    <header class="barra">
      <Icon :name="git.estado?.desprendido ? 'aqui' : 'casa'" :size="16" :class="{ suelto: git.estado?.desprendido }" />
      <span v-if="git.estado?.desprendido" class="rama suelta" title="No hay branch: los commits que se hagan aquí se pierden al cambiar de branch">
        detached HEAD · {{ git.estado.oidCorto }}
      </span>
      <span v-else class="rama">{{ git.estado?.rama ?? '—' }}</span>
      <span v-if="git.estado?.adelante" class="marca ade" title="Commits por subir">
        ↑{{ git.estado.adelante }}
      </span>
      <span v-if="git.estado?.atras" class="marca atr" title="Commits por bajar">
        ↓{{ git.estado.atras }}
      </span>
      <span v-if="git.estado?.upstream" class="up">{{ git.estado.upstream }}</span>

      <span class="hueco" />

      <button
        class="op" :disabled="ocupado"
        title="Trae del remoto lo que haya, sin tocar el árbol de trabajo"
        @click="hacer('Traer', () => git.traer())"
      ><Icon name="nube" :size="14" /> fetch</button>

      <button
        class="op" :class="{ resalta: (git.estado?.atras ?? 0) > 0 }" :disabled="ocupado"
        title="Trae e integra. Solo fast-forward: si la rama divergió, lo dice"
        @click="bajar"
      ><Icon name="abajo" :size="14" /> pull<span v-if="git.estado?.atras">&nbsp;{{ git.estado.atras }}</span></button>

      <button
        class="op" :class="{ resalta: (git.estado?.adelante ?? 0) > 0 }" :disabled="ocupado"
        title="Sube los commits al remoto"
        @click="hacer('Subir', () => git.subir())"
      ><Icon name="arriba" :size="14" /> push<span v-if="git.estado?.adelante">&nbsp;{{ git.estado.adelante }}</span></button>

      <button
        class="op" :disabled="ocupado" title="Crear un branch desde este punto"
        @click="crearRama"
      ><Icon name="rama" :size="14" /> branch</button>

      <button
        class="recargar" :disabled="ocupado"
        title="Vuelve a leer el repositorio: estado, árbol, ramas y stash. No habla con el remoto"
        @click="git.cargar(carpeta, true)"
      ><Icon name="refresh" :size="15" /></button>
    </header>

    <div v-if="pidiendoRama" class="nuevaRama">
      <input
        v-model="nuevaRama" placeholder="nombre del branch nuevo" autofocus
        spellcheck="false"
        @keydown.enter="crearRama" @keydown.escape="pidiendoRama = false"
      >
      <button class="op" @click="crearRama">crear y hacer checkout</button>
      <button class="op" @click="pidiendoRama = false">cancelar</button>
    </div>

    <nav class="pestanas">
      <button :class="{ on: vista === 'arbol' }" @click="vista = 'arbol'">Árbol</button>
      <button :class="{ on: vista === 'trabajo' }" @click="vista = 'trabajo'">
        Cambios
        <span v-if="git.hayTrabajo" class="punto" />
      </button>
    </nav>

    <Loading v-if="git.cargando && !git.estado" />
    <Empty
      v-else-if="git.error" icon="alert" title="No se pudo abrir el repositorio"
      :hint="git.error"
    />

    <div v-else class="cuerpo">
      <div class="arbol" :class="{ oculto: vista !== 'arbol' }">
        <!--
          El trabajo sin commit, arriba de todo y como una fila más del árbol.
          Es donde uno mira para saber en qué está, y tocarlo lleva directo a
          elegir qué mandar al stage.
        -->
        <button
          v-if="git.hayTrabajo" class="wip" :class="{ on: seleccionado === null && vista === 'arbol' }"
          @click="seleccionado = null; lado = 'cambios'; vista = 'trabajo'"
        >
          <span class="punto" />
          <span class="que">Sin commit en {{ git.estado?.rama }}</span>
          <span class="cuenta">
            {{ (git.estado?.preparados.length ?? 0) + (git.estado?.cambiados.length ?? 0) + (git.estado?.sinRastrear.length ?? 0) }}
          </span>
        </button>

        <GrafoCommits
          :commits="git.commits" :ancho="git.anchoMaximo" :seleccionado="seleccionado"
          @elegir="(h) => { seleccionado = seleccionado === h ? null : h; if (seleccionado) vista = 'trabajo'; }"
        />
      </div>

      <aside class="costado" :class="{ oculto: vista !== 'trabajo' }">
        <nav class="sub">
          <button v-if="seleccionado" class="volver" @click="seleccionado = null">
            <Icon name="chevron" :size="13" style="transform: rotate(180deg)" /> volver
          </button>
          <button v-if="!seleccionado" :class="{ on: lado === 'cambios' }" @click="lado = 'cambios'">Trabajo</button>
          <button v-if="!seleccionado" :class="{ on: lado === 'stash' }" @click="lado = 'stash'">
            Stash <span v-if="git.stashes.length" class="n">{{ git.stashes.length }}</span>
          </button>
        </nav>
        <div v-if="seleccionado" class="conAcciones">
          <DetalleCommit
            :hash="seleccionado"
            @ver="(ruta) => verDiffCommit(seleccionado!, ruta)"
          />
          <div class="acciones">
            <button class="op" :disabled="ocupado" @click="situarse(seleccionado!)">
              <Icon name="git" :size="14" /> checkout
            </button>
            <button
              class="op" :disabled="ocupado || !git.estado?.rama"
              title="Rebase del branch actual encima de este commit"
              @click="reordenar(seleccionado!)"
            ><Icon name="arriba" :size="14" /> rebase aquí</button>
          </div>
        </div>
        <PanelCambios v-else-if="lado === 'cambios'" @ver="verDiff" />
        <PanelStash v-else />
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="diff" class="scrim" @click.self="diff = null">
        <div class="hoja" role="dialog" aria-modal="true">
          <header>
            <span class="ruta">{{ diff.ruta }}</span>
            <span class="etiqueta">
              {{ diff.commit ? diff.commit.slice(0, 7) : diff.preparado ? 'staged' : 'unstaged' }}
            </span>
            <button class="x" aria-label="Cerrar" @click="diff = null"><Icon name="close" :size="16" /></button>
          </header>
          <DiffVista v-if="diff.texto" :diff="diff.texto" />
          <p v-else class="sinDiff">No hay diferencias que mostrar.</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.git { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.barra {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 7px 12px; background: var(--bg-panel); border-bottom: 1px solid var(--border);
}
.barra > :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.rama { font-size: 13px; font-weight: 600; }
.rama.suelta { color: var(--warn); font-family: var(--mono); font-size: 12px; }
.barra > :deep(svg.suelto) { color: var(--warn); }
.marca { padding: 1px 7px; border-radius: 20px; font: 11px var(--mono); }
.marca.ade { background: color-mix(in oklab, var(--ok) 20%, transparent); color: var(--ok); }
.marca.atr { background: color-mix(in oklab, var(--warn) 22%, transparent); color: var(--warn); }
.up { font: 11px var(--mono); color: var(--fg-faint); }
.hueco { flex: 1; }
.op {
  display: flex; align-items: center; gap: 5px; flex: 0 0 auto;
  height: 28px; padding: 0 10px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 8px; font-size: 12px; color: var(--fg-dim); white-space: nowrap;
}
.op:hover:not(:disabled) { color: var(--fg); border-color: var(--accent); }
.op:disabled { opacity: .45; cursor: default; }
/* Con algo pendiente el botón se destaca: es la señal de que hay que actuar. */
.op.resalta { border-color: var(--accent); color: var(--accent); }

.nuevaRama {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 8px 12px; background: var(--bg-surface); border-bottom: 1px solid var(--border);
}
.nuevaRama input {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 7px;
  font: 12.5px var(--mono);
}
.nuevaRama input:focus { outline: none; border-color: var(--accent); }

.conAcciones { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.conAcciones .acciones {
  display: flex; gap: 6px; flex: 0 0 auto;
  padding: 9px 12px calc(9px + var(--safe-b));
  border-top: 1px solid var(--border); background: var(--bg-panel);
}
.recargar {
  display: grid; place-items: center; width: 28px; height: 28px;
  border-radius: 7px; color: var(--fg-faint);
}
.recargar:hover { background: var(--bg-hover); color: var(--fg); }

.pestanas { display: none; }

.cuerpo { display: flex; flex: 1; min-height: 0; }

.arbol {
  display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;
  overflow-y: auto; background: var(--bg);
}
.wip {
  display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 34px; padding: 0 12px; text-align: left;
  border-bottom: 1px dashed var(--border-strong);
}
.wip:hover, .wip.on { background: var(--bg-hover); }
.wip .punto {
  width: 9px; height: 9px; flex: 0 0 9px; margin-left: 7px; border-radius: 50%;
  border: 2px dashed var(--accent);
}
.wip .que { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--fg-dim); }
.wip .cuenta {
  flex: 0 0 auto; padding: 0 7px; border-radius: 20px;
  background: var(--accent); color: var(--on-accent); font: 10.5px var(--mono); font-weight: 600;
}

.volver {
  display: flex; align-items: center; gap: 4px;
  padding: 0 0 7px; font-size: 12.5px; color: var(--fg-faint);
}
.volver:hover { color: var(--fg); }

.costado {
  display: flex; flex-direction: column;
  width: 26rem; flex: 0 0 26rem; min-height: 0;
  background: var(--bg-panel); border-left: 1px solid var(--border);
}
.sub { display: flex; gap: 12px; flex: 0 0 auto; padding: 8px 12px 0; }
.sub button {
  display: flex; align-items: center; gap: 5px;
  padding: 0 0 7px; border-bottom: 2px solid transparent;
  font-size: 12.5px; color: var(--fg-faint);
}
.sub button.on { color: var(--fg); font-weight: 600; border-bottom-color: var(--accent); }
.sub .n {
  padding: 0 5px; border-radius: 20px; background: var(--bg-active);
  font: 10px var(--mono); color: var(--fg-dim);
}

/* En angosto el árbol y el panel no entran juntos: se elige con las pestañas. */
@media (max-width: 62rem) {
  .pestanas { display: flex; gap: 14px; flex: 0 0 auto; padding: 8px 14px 0; background: var(--bg-panel); }
  .pestanas button {
    display: flex; align-items: center; gap: 5px;
    padding: 0 0 8px; border-bottom: 2px solid transparent;
    font-size: 13px; color: var(--fg-faint);
  }
  .pestanas button.on { color: var(--fg); font-weight: 600; border-bottom-color: var(--accent); }
  .punto { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .costado { width: auto; flex: 1; border-left: 0; }
  .arbol.oculto, .costado.oculto { display: none; }
}

.scrim {
  position: fixed; inset: 0; z-index: 64;
  display: grid; place-items: center; padding: 1.5rem;
  padding-top: calc(1.5rem + var(--safe-t)); padding-bottom: calc(1.5rem + var(--safe-b));
  background: var(--scrim);
}
.hoja {
  display: flex; flex-direction: column;
  width: 100%; max-width: 62rem; height: 100%; max-height: 46rem;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: 0 24px 60px var(--shadow); overflow: hidden;
}
.hoja header {
  display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
  padding: 11px 12px 11px 16px; background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.ruta { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font: 12px var(--mono); }
.etiqueta {
  flex: 0 0 auto; padding: 1px 8px; border-radius: 20px;
  background: var(--bg-surface); font: 10.5px var(--mono); color: var(--fg-faint);
}
.x { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--fg-faint); }
.x:hover { background: var(--bg-hover); color: var(--fg); }
.sinDiff { margin: auto; font-size: 13px; color: var(--fg-faint); }
</style>
