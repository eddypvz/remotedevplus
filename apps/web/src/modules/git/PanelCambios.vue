<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import { useGit, type GitArchivo } from '../../stores/git';
import { useDialogo } from '../../stores/dialogo';
import { useTabs } from '../../stores/tabs';

/**
 * Las tres cubetas del trabajo sin commit.
 *
 * Separadas y siempre visibles, con su cuenta a la vista. En VS Code todo cae
 * en una lista donde lo preparado y lo que no se distinguen por un icono
 * diminuto, y hay que pasar el mouse por encima para actuar — en tablet, donde
 * no hay hover, eso directamente no funciona.
 *
 * Acá cada archivo tiene sus botones puestos y cada cubeta se prepara o se
 * quita entera de un toque.
 */
const git = useGit();
const dialogo = useDialogo();
const tabs = useTabs();
const emit = defineEmits<{ (e: 'ver', ruta: string, preparado: boolean): void }>();

const mensaje = ref('');
/** Rutas marcadas, para actuar sobre varias a la vez. */
const marcadas = ref(new Set<string>());
const enmendar = ref(false);
const trabajando = ref(false);
const error = ref('');

const e = computed(() => git.estado);
const puedeHacerCommit = computed(() => (
  mensaje.value.trim().length > 0 && ((e.value?.preparados.length ?? 0) > 0 || enmendar.value)
));

/**
 * Todo lo que no está preparado: es sobre esto que se elige qué preparar y qué
 * revertir. Lo ya preparado no entra — revertirlo sería otra operación.
 */
const revertibles = computed(() => [
  ...(e.value?.cambiados ?? []),
  ...(e.value?.sinRastrear ?? []),
]);

const todasMarcadas = computed(() => (
  revertibles.value.length > 0 && revertibles.value.every((a) => marcadas.value.has(a.ruta))
));
const algunaMarcada = computed(() => marcadas.value.size > 0);
const seleccion = computed(() => revertibles.value.filter((a) => marcadas.value.has(a.ruta)));

function marcar(ruta: string) {
  const s = new Set(marcadas.value);
  s.has(ruta) ? s.delete(ruta) : s.add(ruta);
  marcadas.value = s;
}

function marcarTodas() {
  marcadas.value = todasMarcadas.value
    ? new Set()
    : new Set(revertibles.value.map((a) => a.ruta));
}

const nombre = (r: string) => r.split('/').pop() ?? r;
const carpeta = (r: string) => { const i = r.lastIndexOf('/'); return i > 0 ? r.slice(0, i) : ''; };

const LETRA: Record<string, string> = {
  modificado: 'M', agregado: 'A', borrado: 'B', renombrado: 'R',
  copiado: 'C', tipo: 'T', nuevo: 'N', conflicto: '!',
};

async function con(fn: () => Promise<unknown>) {
  trabajando.value = true;
  error.value = '';
  try {
    await fn();
    // Después de actuar, las rutas que ya no están sin preparar dejan de estar
    // marcadas: si no, la selección apuntaría a archivos que ya se movieron.
    const vivas = new Set(revertibles.value.map((a) => a.ruta));
    marcadas.value = new Set([...marcadas.value].filter((r) => vivas.has(r)));
  } catch (err: any) {
    error.value = err?.message || 'Falló la operación';
  } finally {
    trabajando.value = false;
  }
}

const rutas = (lista: GitArchivo[]) => lista.map((a) => a.ruta);

async function hacerCommit() {
  if (!puedeHacerCommit.value) return;
  await con(async () => {
    await git.commit(mensaje.value, enmendar.value);
    mensaje.value = '';
    enmendar.value = false;
    await git.cargar(git.cwd!, true);
  });
}

/*
 * CONFLICTOS
 *
 * `ours` y `theirs` significan lo contrario según la operación: en un merge
 * "ours" es la rama en la que se está, y en un rebase es el commit que se está
 * aplicando encima. Por eso los botones se nombran según la operación en curso
 * en vez de decir "el mío" y "el de ellos", que en un rebase engaña.
 */
const LADOS = {
  merge: { ours: 'esta branch', theirs: 'la que entra' },
  rebase: { ours: 'sobre la que rebaso', theirs: 'mi commit' },
  'cherry-pick': { ours: 'esta branch', theirs: 'el commit' },
  revert: { ours: 'esta branch', theirs: 'el revert' },
} as const;

const ladoNombre = (side: 'ours' | 'theirs') => (
  LADOS[e.value?.operacion ?? 'merge']?.[side] ?? (side === 'ours' ? 'lo nuestro' : 'lo suyo')
);

const OPERACION: Record<string, string> = {
  merge: 'Un merge quedó a medias',
  rebase: 'Un rebase quedó a medias',
  'cherry-pick': 'Un cherry-pick quedó a medias',
  revert: 'Un revert quedó a medias',
};

async function resolver(ruta: string, side: 'ours' | 'theirs' | 'manual') {
  if (side === 'manual') return con(() => git.resolver([ruta], 'manual'));
  const ok = await dialogo.confirmar({
    titulo: `Quedarse con ${ladoNombre(side)}`,
    mensaje: 'Se descarta por completo el otro lado en este archivo y queda resuelto (staged). '
      + 'No se puede deshacer sin volver a empezar la operación.',
    detalle: ruta,
    aceptar: 'Quedarme con este', peligroso: true,
  });
  if (!ok) return;
  await con(() => git.resolver([ruta], side));
}

async function seguir(accion: 'continuar' | 'abortar') {
  if (accion === 'abortar') {
    const ok = await dialogo.confirmar({
      titulo: 'Abortar la operación',
      mensaje: 'El repositorio vuelve a como estaba antes de empezar. Lo resuelto hasta ahora se pierde.',
      aceptar: 'Abortar', peligroso: true,
    });
    if (!ok) return;
  }
  await con(async () => {
    await git.seguir(accion);
    await git.cargar(git.cwd!, true);
  });
}

async function descartar(lista: GitArchivo[]) {
  const n = lista.length;
  const ok = await dialogo.confirmar({
    titulo: n === 1 ? 'Revertir el archivo' : `Revertir ${n} archivos`,
    mensaje: 'Los cambios vuelven a como estaban en el último commit. No se puede deshacer.',
    detalle: lista.map((a) => a.ruta).slice(0, 12).join('\n')
      + (n > 12 ? `\n… y ${n - 12} más` : ''),
    aceptar: 'Revertir', peligroso: true,
  });
  if (!ok) return;
  await con(() => git.descartar(rutas(lista)));
}
</script>

<template>
  <div class="panel">
    <p v-if="error" class="err">{{ error }}</p>

    <!--
      Marcar y actuar sobre varios. Revertir es lo que más se necesita elegir a
      dedo: descartar todo de una es raro, descartar tres archivos de doce es lo
      habitual.
    -->
    <div v-if="revertibles.length" class="seleccion">
      <label class="marcarTodo">
        <input
          type="checkbox" :checked="todasMarcadas"
          :indeterminate="algunaMarcada && !todasMarcadas"
          @change="marcarTodas"
        >
        {{ algunaMarcada ? `${marcadas.size} de ${revertibles.length}` : 'seleccionar todo' }}
      </label>
      <span class="hueco" />
      <template v-if="algunaMarcada">
        <button class="lote" @click="con(() => git.preparar(rutas(seleccion)))">
          stage
        </button>
        <button class="lote mal" @click="descartar(seleccion)">
          revertir
        </button>
      </template>
    </div>

    <!-- Staged: lo que va a entrar al commit -->
    <section v-if="e?.preparados.length" class="cubeta preparada">
      <header>
        <span class="titulo">Staged</span>
        <span class="cuenta">{{ e.preparados.length }}</span>
        <button class="todo" @click="con(() => git.quitar(rutas(e!.preparados)))">unstage todo</button>
      </header>
      <div v-for="a in e.preparados" :key="a.ruta" class="fila" @click="emit('ver', a.ruta, true)">
        <span class="letra ok">{{ LETRA[a.staged!] ?? '?' }}</span>
        <span class="nombre">{{ nombre(a.ruta) }}</span>
        <span class="carpeta">{{ carpeta(a.ruta) }}</span>
        <button class="acto" title="Quitar del stage" @click.stop="con(() => git.quitar([a.ruta]))">
          <Icon name="close" :size="13" />
        </button>
      </div>
    </section>

    <!-- Unstaged: modificados pero todavía fuera del commit -->
    <section v-if="e?.cambiados.length" class="cubeta">
      <header>
        <span class="titulo">Unstaged</span>
        <span class="cuenta">{{ e.cambiados.length }}</span>
        <button class="todo" @click="con(() => git.preparar(rutas(e!.cambiados)))">stage todo</button>
      </header>
      <div v-for="a in e.cambiados" :key="a.ruta" class="fila" :class="{ marcada: marcadas.has(a.ruta) }" @click="emit('ver', a.ruta, false)">
        <input
          class="tilde" type="checkbox" :checked="marcadas.has(a.ruta)"
          :aria-label="`Seleccionar ${a.ruta}`" @click.stop @change="marcar(a.ruta)"
        >
        <span class="letra">{{ LETRA[a.arbol!] ?? '?' }}</span>
        <span class="nombre">{{ nombre(a.ruta) }}</span>
        <span class="carpeta">{{ carpeta(a.ruta) }}</span>
        <button class="acto mal" title="Revertir los cambios" @click.stop="descartar([a])">
          <Icon name="refresh" :size="13" />
        </button>
        <button class="acto sumar" title="Hacer stage" @click.stop="con(() => git.preparar([a.ruta]))">
          <Icon name="plus" :size="13" />
        </button>
      </div>
    </section>

    <!-- Untracked: git todavía no los conoce -->
    <section v-if="e?.sinRastrear.length" class="cubeta">
      <header>
        <span class="titulo">Untracked</span>
        <span class="cuenta">{{ e.sinRastrear.length }}</span>
        <button class="todo" @click="con(() => git.preparar(rutas(e!.sinRastrear)))">stage todo</button>
      </header>
      <div v-for="a in e.sinRastrear" :key="a.ruta" class="fila" :class="{ marcada: marcadas.has(a.ruta) }" @click="tabs.open('file', { path: git.cwd + '/' + a.ruta })">
        <input
          class="tilde" type="checkbox" :checked="marcadas.has(a.ruta)"
          :aria-label="`Seleccionar ${a.ruta}`" @click.stop @change="marcar(a.ruta)"
        >
        <span class="letra nuevo">N</span>
        <span class="nombre">{{ nombre(a.ruta) }}</span>
        <span class="carpeta">{{ carpeta(a.ruta) }}</span>
        <button class="acto sumar" title="Hacer stage" @click.stop="con(() => git.preparar([a.ruta]))">
          <Icon name="plus" :size="13" />
        </button>
      </div>
    </section>

    <section v-if="e?.conflictos.length" class="cubeta conflictiva">
      <header>
        <span class="titulo">Conflicts</span>
        <span class="cuenta">{{ e.conflictos.length }}</span>
      </header>
      <div v-for="a in e.conflictos" :key="a.ruta" class="conflicto">
        <div class="fila" @click="tabs.open('file', { path: git.cwd + '/' + a.ruta })">
          <span class="letra malo">!</span>
          <span class="nombre">{{ nombre(a.ruta) }}</span>
          <span class="carpeta">{{ carpeta(a.ruta) }}</span>
        </div>
        <!--
          Los tres caminos reales: quedarse con un lado entero, o editar el
          archivo a mano y decir que ya está. Un editor de tres paneles sería
          mejor, pero en tablet no entra; abrir el archivo con sus marcadores sí.
        -->
        <div class="lados">
          <button :disabled="trabajando" @click.stop="resolver(a.ruta, 'ours')">
            usar {{ ladoNombre('ours') }}
          </button>
          <button :disabled="trabajando" @click.stop="resolver(a.ruta, 'theirs')">
            usar {{ ladoNombre('theirs') }}
          </button>
          <button class="listo" :disabled="trabajando" title="Ya lo edité a mano" @click.stop="resolver(a.ruta, 'manual')">
            resuelto
          </button>
        </div>
      </div>
    </section>

    <!--
      Cuando ya no quedan conflictos, lo único que falta es continuar. El aviso
      aparece igual con conflictos pendientes, porque abortar tiene que estar a
      mano en todo momento.
    -->
    <div v-if="e?.operacion" class="secuencia">
      <p>
        <Icon name="alert" :size="14" />
        {{ OPERACION[e.operacion] ?? 'Una operación quedó a medias' }}<span
          v-if="e.conflictos.length"
        >: quedan {{ e.conflictos.length }} conflicto{{ e.conflictos.length === 1 ? '' : 's' }}</span>.
      </p>
      <div class="botones">
        <button
          class="seguir" :disabled="trabajando || !!e.conflictos.length"
          :title="e.conflictos.length ? 'Primero hay que resolver los conflictos' : 'Continuar la operación'"
          @click="seguir('continuar')"
        >continuar</button>
        <button class="abortar" :disabled="trabajando" @click="seguir('abortar')">abortar</button>
      </div>
    </div>

    <p v-if="!git.hayTrabajo" class="limpio">
      <Icon name="chevron" :size="14" /> No hay cambios sin commit.
    </p>

    <!-- La caja de commit, siempre al pie -->
    <div class="commit">
      <textarea
        v-model="mensaje" rows="2" class="mensaje"
        placeholder="Mensaje del commit…"
        @keydown.enter.meta.prevent="hacerCommit"
        @keydown.enter.ctrl.prevent="hacerCommit"
      />
      <div class="acciones">
        <label class="enmendar" title="Rehace el último commit en vez de crear uno nuevo">
          <input v-model="enmendar" type="checkbox"> amend
        </label>
        <span class="hueco" />
        <button class="hacer" :disabled="!puedeHacerCommit || trabajando" @click="hacerCommit">
          {{ trabajando ? '…' : `Hacer commit ${e?.preparados.length ? `(${e.preparados.length})` : ''}` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }

.cubeta { display: flex; flex-direction: column; flex: 0 0 auto; }
.cubeta header {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: 7px;
  padding: 7px 12px 5px; background: var(--bg-panel);
}
.titulo {
  font-size: 10.5px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: var(--fg-faint);
}
.cuenta {
  padding: 0 6px; border-radius: 20px; background: var(--bg-active);
  font: 10.5px var(--mono); color: var(--fg-dim);
}
.cubeta.preparada .cuenta { background: var(--ok); color: var(--bg); }
.cubeta.conflictiva .cuenta { background: var(--danger); color: #fff; }
.todo {
  margin-left: auto; padding: 2px 8px; border-radius: 6px;
  font-size: 11px; color: var(--fg-faint); border: 1px solid transparent;
}
.todo:hover { color: var(--accent); border-color: var(--accent); }

.seleccion {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  padding: 7px 12px; border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
}
.marcarTodo { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--fg-dim); cursor: pointer; }
.marcarTodo input { width: 15px; height: 15px; accent-color: var(--accent); }
.lote {
  padding: 3px 10px; border-radius: 7px; border: 1px solid var(--border-strong);
  font-size: 11.5px; color: var(--fg-dim);
}
.lote:hover { border-color: var(--accent); color: var(--accent); }
.lote.mal:hover { border-color: var(--danger); color: var(--danger); }

.fila {
  display: flex; align-items: center; gap: 8px;
  min-height: var(--touch); padding: 0 8px 0 12px;
  cursor: pointer;
}
.fila:hover { background: var(--bg-hover); }
.fila.marcada { background: color-mix(in oklab, var(--accent) 9%, transparent); }
.tilde { width: 15px; height: 15px; flex: 0 0 15px; accent-color: var(--accent); }

.letra {
  display: grid; place-items: center; flex: 0 0 18px;
  width: 18px; height: 18px; border-radius: 4px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  font: 600 10px var(--mono); color: var(--fg-dim);
}
.letra.ok { border-color: var(--ok); color: var(--ok); }
.letra.nuevo { border-color: var(--accent); color: var(--accent); }
.letra.malo { border-color: var(--danger); color: var(--danger); }

.nombre { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.carpeta {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left; font: 10.5px var(--mono); color: var(--fg-faint);
}

/*
 * Los botones están puestos, no aparecen al pasar el mouse. En tablet no hay
 * hover, y esconder la acción detrás de un gesto que no existe es lo que hace
 * inusable el panel de git de VS Code ahí.
 */
.acto {
  display: grid; place-items: center; flex: 0 0 30px;
  width: 30px; height: 30px; border-radius: 7px; color: var(--fg-faint);
}
.acto:hover { background: var(--bg-active); color: var(--fg); }
.acto.sumar:hover { color: var(--ok); }
.acto.mal:hover { color: var(--danger); }

.conflicto { display: flex; flex-direction: column; }
.lados {
  display: flex; gap: 5px; flex-wrap: wrap;
  padding: 0 12px 8px 30px;
}
.lados button {
  flex: 0 1 auto; min-height: 28px; padding: 0 10px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 7px; font-size: 11.5px; color: var(--fg-dim); white-space: nowrap;
}
.lados button:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
.lados button.listo:hover:not(:disabled) { border-color: var(--ok); color: var(--ok); }
.lados button:disabled { opacity: .45; cursor: default; }

.secuencia {
  display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto;
  margin: 8px 10px; padding: 10px 12px;
  background: color-mix(in oklab, var(--warn) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--warn) 40%, transparent);
  border-radius: 10px;
}
.secuencia p {
  display: flex; align-items: center; gap: 7px; margin: 0;
  font-size: 12.5px; line-height: 1.5; color: var(--fg);
}
.secuencia :deep(svg) { flex: 0 0 auto; color: var(--warn); }
.secuencia .botones { display: flex; gap: 6px; }
.secuencia button {
  min-height: 30px; padding: 0 12px; border-radius: 8px;
  font-size: 12px; font-weight: 550;
}
.secuencia .seguir { background: var(--accent); color: var(--on-accent); }
.secuencia .abortar { background: var(--bg-surface); border: 1px solid var(--border-strong); color: var(--fg-dim); }
.secuencia .abortar:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
.secuencia button:disabled { opacity: .45; cursor: default; }

.limpio {
  display: flex; align-items: center; gap: 7px; justify-content: center;
  margin: 0; padding: 22px 12px; font-size: 12.5px; color: var(--fg-faint);
}
.limpio :deep(svg) { color: var(--ok); }

.commit {
  display: flex; flex-direction: column; gap: 7px; flex: 0 0 auto;
  margin-top: auto; padding: 10px 12px calc(10px + var(--safe-b));
  border-top: 1px solid var(--border); background: var(--bg-panel);
  position: sticky; bottom: 0;
}
.mensaje {
  width: 100%; min-height: 52px; max-height: 30dvh; padding: 9px 11px; resize: vertical;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 9px;
  font: 16px/1.5 var(--font);
}
.mensaje:focus { outline: none; border-color: var(--accent); }
@media (pointer: fine) { .mensaje { font-size: 13px; } }

.acciones { display: flex; align-items: center; gap: 8px; }
.enmendar { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--fg-faint); cursor: pointer; }
.enmendar input { width: 14px; height: 14px; accent-color: var(--accent); }
.hueco { flex: 1; }
.hacer {
  height: 34px; padding: 0 15px; border-radius: 9px;
  background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 12.5px;
}
.hacer:disabled { background: var(--bg-active); color: var(--fg-faint); cursor: default; }

.err { margin: 8px 12px; font-size: 12px; color: var(--danger); }
</style>
