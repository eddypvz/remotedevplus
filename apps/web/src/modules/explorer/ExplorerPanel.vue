<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import MenuContextual, { type OpcionMenu } from '../../ui/MenuContextual.vue';
import { useFiles, type TreeRow } from '../../stores/files';
import { useWorkspaces } from '../../stores/workspaces';
import { useTabs } from '../../stores/tabs';
import { useTerminals } from '../../stores/terminals';
import { useSession } from '../../stores/session';
import { useDialogo } from '../../stores/dialogo';
import { copiar } from '../../ui/portapapeles';

const files = useFiles();
const workspaces = useWorkspaces();
const tabs = useTabs();
const terminals = useTerminals();
const session = useSession();
const dialogo = useDialogo();

const puedeEscribir = computed(() => session.can('fs:write'));

onMounted(() => { if (!files.rows.length) files.openInitial(); });

function activate(row: TreeRow) {
  if (row.entry.kind === 'dir') files.toggle(row.entry.path);
  else tabs.open('file', { path: row.entry.path });
}

const aviso = ref('');
const avisoMalo = ref(false);
let relojAviso: number | undefined;

function decir(texto: string, malo = false) {
  aviso.value = texto;
  avisoMalo.value = malo;
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => { aviso.value = ''; }, malo ? 6000 : 2500) as unknown as number;
}

/**
 * Las tres formas de referirse a un archivo, porque las tres se usan.
 *
 * - **nombre**: para renombrar, buscar o mencionarlo en una conversación.
 * - **relativa**: para pegársela a Claude, que entiende `@ruta/relativa` desde
 *   su directorio de trabajo. Es la que más se usa, por eso quedó primero.
 * - **completa**: para un comando en el terminal, un `.env` o un vhost, donde
 *   una ruta relativa no sirve de nada.
 */
function rutaRelativa(path: string) {
  const carpeta = files.folders.find((f) => path.startsWith(f.path + '/'));
  return carpeta ? path.slice(carpeta.path.length + 1) : path;
}

async function copiarTexto(texto: string, que: string) {
  decir(await copiar(texto) ? `${que}: ${texto}` : 'No se pudo copiar', false);
}

function openTerminalHere(row: TreeRow) {
  // Cada invocación abre una terminal nueva, como el editor de VS Code: las que
  // ya existen se recuperan desde el panel de terminales.
  const cwd = dirDestino(row);
  terminals.abrir(cwd, row.entry.kind === 'dir' ? row.entry.name : undefined);
}

/**
 * Dónde cae lo que se cree desde una fila.
 *
 * Sobre una carpeta, dentro de ella; sobre un archivo, al lado. Es lo que se
 * espera y evita tener media docena de opciones deshabilitadas cuando la fila
 * tocada resulta ser un archivo.
 */
const dirDestino = (row: TreeRow) => (
  row.entry.kind === 'dir' ? row.entry.path : files.dirDe(row.entry.path)
);

/* ---------- menú contextual ---------- */

const menu = ref<{ x: number; y: number; row: TreeRow } | null>(null);

const opciones = computed<OpcionMenu[]>(() => {
  const row = menu.value?.row;
  if (!row) return [];
  const esDir = row.entry.kind === 'dir';
  const raiz = row.depth === 0;
  const pp = files.portapapeles;
  const w = puedeEscribir.value;

  return [
    { id: 'abrir', etiqueta: esDir ? (row.expanded ? 'Contraer' : 'Desplegar') : 'Abrir', icono: esDir ? 'folder' : 'file' },
    { id: 'sep1', separador: true },
    { id: 'nuevoArchivo', etiqueta: 'Nuevo archivo…', icono: 'plus', deshabilitado: !w },
    { id: 'nuevaCarpeta', etiqueta: 'Nueva carpeta…', icono: 'folder', deshabilitado: !w },
    { id: 'subir', etiqueta: 'Subir archivos aquí…', icono: 'arriba', deshabilitado: !w },
    { id: 'sep2', separador: true },
    { id: 'copiar', etiqueta: 'Copiar', icono: 'file', deshabilitado: raiz },
    { id: 'cortar', etiqueta: 'Cortar', icono: 'close', deshabilitado: !w || raiz },
    {
      id: 'pegar',
      etiqueta: pp ? `Pegar ${pp.paths.length} elemento${pp.paths.length > 1 ? 's' : ''}` : 'Pegar',
      icono: 'plus',
      deshabilitado: !w || !pp,
    },
    { id: 'copiarNombre', etiqueta: 'Copiar el nombre', icono: 'panel' },
    { id: 'copiarRuta', etiqueta: 'Copiar la ruta relativa', icono: 'panel' },
    { id: 'copiarRutaCompleta', etiqueta: 'Copiar la ruta completa', icono: 'panel' },
    // Solo archivos: una carpeta habría que comprimirla, y el agente no lo hace.
    { id: 'descargar', etiqueta: 'Descargar', icono: 'abajo', deshabilitado: esDir },
    { id: 'sep3', separador: true },
    { id: 'renombrar', etiqueta: 'Renombrar…', icono: 'settings', deshabilitado: !w || raiz },
    { id: 'duplicar', etiqueta: 'Duplicar', icono: 'files', deshabilitado: !w || raiz },
    ...(session.can('module:terminal')
      ? [{ id: 'sep4', separador: true }, { id: 'terminal', etiqueta: 'Abrir una terminal aquí', icono: 'terminal' }]
      : []),
    { id: 'sep5', separador: true },
    {
      id: 'eliminar',
      etiqueta: 'Eliminar',
      icono: 'alert',
      peligroso: true,
      // Una carpeta raíz es del workspace, no del disco: quitarla se hace en el
      // gestor de workspaces, y borrarla desde acá sería una sorpresa muy cara.
      deshabilitado: !w || raiz,
    },
  ];
});

function abrirMenu(e: MouseEvent | { clientX: number; clientY: number }, row: TreeRow) {
  menu.value = { x: e.clientX, y: e.clientY, row };
}

async function elegir(id: string) {
  const row = menu.value?.row;
  menu.value = null;
  if (!row) return;
  try {
    await ejecutar(id, row);
  } catch (e: any) {
    decir(e?.message || 'No se pudo completar la operación', true);
  }
}

async function ejecutar(id: string, row: TreeRow) {
  const dir = dirDestino(row);
  const nombre = row.entry.name;

  switch (id) {
    case 'abrir':
      return activate(row);

    case 'nuevoArchivo': {
      const n = await dialogo.pedirTexto({
        titulo: 'Nuevo archivo',
        mensaje: `Se creará dentro de ${nombreCorto(dir)}.`,
        entrada: { marcador: 'notas.md' },
        aceptar: 'Crear',
      });
      if (!n) return;
      const path = await files.crearArchivo(dir, n);
      tabs.open('file', { path });
      return;
    }

    case 'nuevaCarpeta': {
      const n = await dialogo.pedirTexto({
        titulo: 'Nueva carpeta',
        mensaje: `Se creará dentro de ${nombreCorto(dir)}.`,
        entrada: { marcador: 'componentes' },
        aceptar: 'Crear',
      });
      if (!n) return;
      await files.crearCarpeta(dir, n);
      return;
    }

    case 'subir':
      return pedirArchivos(dir);

    case 'copiar':
      files.copiarAlPortapapeles([row.entry.path], 'copiar');
      return decir(`${nombre} copiado`);

    case 'cortar':
      files.copiarAlPortapapeles([row.entry.path], 'cortar');
      return decir(`${nombre} cortado`);

    case 'pegar': {
      const hechos = await files.pegarEn(dir);
      return decir(`${hechos.length} elemento${hechos.length === 1 ? '' : 's'} en ${nombreCorto(dir)}`);
    }

    case 'copiarNombre':
      return copiarTexto(row.entry.name, 'Nombre');

    case 'copiarRuta':
      return copiarTexto(rutaRelativa(row.entry.path), 'Ruta');

    case 'copiarRutaCompleta':
      return copiarTexto(row.entry.path, 'Ruta completa');

    case 'descargar':
      return descargar(row.entry.path);

    case 'renombrar': {
      const n = await dialogo.pedirTexto({
        titulo: 'Renombrar',
        entrada: { valor: nombre, seleccionarBase: row.entry.kind === 'file' },
        aceptar: 'Renombrar',
      });
      if (!n || n === nombre) return;
      await files.renombrar(row.entry.path, n);
      return decir(`Ahora se llama ${n}`);
    }

    case 'duplicar': {
      files.copiarAlPortapapeles([row.entry.path], 'copiar');
      const hechos = await files.pegarEn(files.dirDe(row.entry.path));
      files.copiarAlPortapapeles([], 'copiar');
      return decir(`Duplicado como ${hechos[0]?.split('/').pop() ?? nombre}`);
    }

    case 'terminal':
      return openTerminalHere(row);

    case 'eliminar': {
      const esDir = row.entry.kind === 'dir';
      const ok = await dialogo.confirmar({
        titulo: esDir ? 'Eliminar la carpeta' : 'Eliminar el archivo',
        mensaje: esDir
          ? 'Se elimina con todo lo que contiene. No hay papelera: esto no se puede deshacer.'
          : 'No hay papelera: esto no se puede deshacer.',
        detalle: row.entry.path,
        aceptar: 'Eliminar',
        peligroso: true,
      });
      if (!ok) return;
      await files.eliminar(row.entry.path, esDir);
      return decir(`${nombre} eliminado`);
    }
  }
}

const nombreCorto = (p: string) => p.split('/').filter(Boolean).pop() || p;

/**
 * Baja un archivo al dispositivo.
 *
 * Un ancla temporal y no `location.href`: la respuesta trae
 * `content-disposition: attachment`, pero navegar la pestaña principal a una
 * descarga deja el SPA en un estado raro en algunos navegadores. Con el ancla
 * la página no se mueve. En el iPad el archivo cae en la app Archivos.
 */
function descargar(path: string) {
  const a = document.createElement('a');
  a.href = `/api/fs/download?path=${encodeURIComponent(path)}`;
  a.download = path.split('/').pop() ?? 'archivo';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- pulsación larga, que es el clic derecho de una tablet ---------- */

let relojLargo: number | undefined;
let hubieraSidoLargo = false;
let partida = { x: 0, y: 0 };

function tocar(e: PointerEvent, row: TreeRow) {
  if (e.pointerType === 'mouse') return;
  hubieraSidoLargo = false;
  partida = { x: e.clientX, y: e.clientY };
  relojLargo = setTimeout(() => {
    hubieraSidoLargo = true;
    // Vibra si el dispositivo puede: sin la respuesta háptica no se sabe que el
    // menú se abrió por mantener apretado y no por otra cosa.
    navigator.vibrate?.(8);
    abrirMenu({ clientX: partida.x, clientY: partida.y }, row);
  }, 500) as unknown as number;
}

function mover(e: PointerEvent) {
  // Un dedo que se desplaza está haciendo scroll, no manteniendo apretado.
  if (Math.hypot(e.clientX - partida.x, e.clientY - partida.y) > 10) clearTimeout(relojLargo);
}

function soltarDedo() { clearTimeout(relojLargo); }

/** Tras una pulsación larga el `click` que viene detrás no debe abrir nada. */
function alHacerClic(row: TreeRow) {
  if (hubieraSidoLargo) { hubieraSidoLargo = false; return; }
  activate(row);
}

/* ---------- subida de archivos ---------- */

const entrada = ref<HTMLInputElement>();
const destinoSubida = ref<string | null>(null);
const subiendo = ref<{ hechos: number; total: number } | null>(null);
const encima = ref<string | null>(null);

function pedirArchivos(dir: string) {
  destinoSubida.value = dir;
  entrada.value?.click();
}

async function alElegirArchivos(e: Event) {
  const input = e.target as HTMLInputElement;
  const lista = [...(input.files ?? [])];
  input.value = '';
  if (lista.length && destinoSubida.value) await subir(destinoSubida.value, lista);
}

async function subir(dir: string, lista: File[]) {
  subiendo.value = { hechos: 0, total: lista.length };
  try {
    const { subidos, fallos } = await files.subir(dir, lista, (hechos, total) => {
      subiendo.value = { hechos, total };
    });
    if (fallos.length) {
      decir(`${subidos.length} subidos · falló ${fallos.map((f) => f.nombre).join(', ')}: ${fallos[0].motivo}`, true);
    } else {
      decir(`${subidos.length} archivo${subidos.length === 1 ? '' : 's'} en ${nombreCorto(dir)}`);
    }
  } finally {
    subiendo.value = null;
  }
}

/**
 * Arrastrar y soltar desde el escritorio.
 *
 * Solo archivos sueltos: un directorio arrastrado llega como una entrada vacía
 * y habría que recorrerlo con la API de entradas del navegador, que no está en
 * Safari de iPad. Se avisa en vez de subir una carpeta a medias.
 */
function soltarArchivos(e: DragEvent, dir: string) {
  encima.value = null;
  const dt = e.dataTransfer;
  if (!dt || !puedeEscribir.value) return;
  const lista = [...dt.files];
  const carpetas = [...(dt.items ?? [])].filter((i) => i.webkitGetAsEntry?.()?.isDirectory).length;
  if (carpetas) decir('Las carpetas no se pueden arrastrar; se suben sus archivos sueltos', true);
  if (lista.length) subir(dir, lista);
}

/**
 * La barra de arriba actúa sobre la primera carpeta del workspace.
 *
 * Se reutiliza `ejecutar` armando una fila sintética en vez de duplicar la
 * lógica: así crear desde la barra y crear desde el menú no pueden divergir.
 */
function filaDe(path: string): TreeRow {
  return {
    entry: { name: nombreCorto(path), path, kind: 'dir', size: null, mtime: null },
    depth: 1, expanded: files.expanded.has(path), loading: false,
  };
}

async function desdeLaBarra(id: string) {
  const dir = raizPorDefecto.value;
  if (!dir) return;
  try {
    await ejecutar(id, filaDe(dir));
  } catch (e: any) {
    decir(e?.message || 'No se pudo completar la operación', true);
  }
}

/**
 * Pegar archivos con Cmd+V / Ctrl+V.
 *
 * Es la mitad que un navegador puede hacer. La otra —copiar acá y pegar en
 * Finder— **no es posible**: escribir referencias de archivo en el portapapeles
 * del sistema (`NSFilenamesPboardType`, `CF_HDROP`) no está al alcance de una
 * página. VS Code lo logra porque es una aplicación nativa, no una web.
 *
 * Y ojo con lo que llega: copiar un archivo en Finder muchas veces deja en el
 * portapapeles solo su **icono de previsualización**, no los bytes. Con una
 * captura de pantalla o algo copiado desde otra aplicación funciona bien. Por
 * eso arrastrar sigue siendo el camino confiable, y se dice cuando lo pegado no
 * sirve en vez de subir un PNG de 300 bytes que parece el archivo.
 */
async function pegarArchivos(e: ClipboardEvent) {
  if (!puedeEscribir.value) return;
  const dir = destinoDePegado();
  if (!dir) return;

  const lista = [...(e.clipboardData?.files ?? [])];
  if (!lista.length) return;
  e.preventDefault();

  // Un solo `image/png` sin nombre propio es la firma de la previsualización
  // que deja Finder, no del archivo que se creía copiar.
  const sospechoso = lista.length === 1
    && lista[0].type === 'image/png'
    && /^(image|imagen|captura)\.png$/i.test(lista[0].name);
  if (sospechoso) {
    decir('El sistema pegó una previsualización, no el archivo. Arrástrelo en su lugar.', true);
    return;
  }
  await subir(dir, lista);
}

/** Dónde cae lo pegado: la carpeta marcada, o la primera del workspace. */
function destinoDePegado() {
  const fila = files.rows.find((r) => r.entry.path === marcada.value);
  if (fila) return dirDestino(fila);
  return raizPorDefecto.value;
}

/** Última fila tocada, para que pegar y crear caigan donde se está mirando. */
const marcada = ref<string | null>(null);

/** La carpeta a la que va lo que se suelte en el fondo del panel. */
const raizPorDefecto = computed(() => files.folders[0]?.path ?? null);
</script>

<template>
  <div
    class="explorer" tabindex="-1"
    @paste="pegarArchivos"
    @dragover.prevent="() => {}"
    @drop.prevent="(e) => raizPorDefecto && soltarArchivos(e, raizPorDefecto)"
  >
    <!-- El workspace activo se cambia desde aquí, sin ir a ajustes: es donde
         está la vista cuando surge la necesidad de otro proyecto. -->
    <button class="switcher" @click="workspaces.pickerOpen = true">
      <span class="nm">{{ workspaces.active?.name ?? 'Sin workspace' }}</span>
      <span class="count" v-if="workspaces.active">
        {{ workspaces.active.folders.length }}
      </span>
      <Icon name="chevron" :size="14" style="transform: rotate(90deg)" />
    </button>

    <div v-if="puedeEscribir && raizPorDefecto" class="herramientas">
      <button :title="`Nuevo archivo en ${nombreCorto(raizPorDefecto)}`" @click="desdeLaBarra('nuevoArchivo')">
        <Icon name="plus" :size="14" />
      </button>
      <button :title="`Nueva carpeta en ${nombreCorto(raizPorDefecto)}`" @click="desdeLaBarra('nuevaCarpeta')">
        <Icon name="folder" :size="14" />
      </button>
      <button :title="`Subir archivos a ${nombreCorto(raizPorDefecto)}`" @click="pedirArchivos(raizPorDefecto)">
        <Icon name="arriba" :size="14" />
      </button>
      <span class="hueco" />
      <!-- El portapapeles se ve: sin esto, copiar algo y cambiar de carpeta deja
           al usuario sin saber si todavía tiene algo para pegar. -->
      <button
        v-if="files.portapapeles" class="pp" :title="`Pegar en ${nombreCorto(raizPorDefecto)}`"
        @click="desdeLaBarra('pegar')"
      >
        {{ files.portapapeles.modo === 'cortar' ? 'cortado' : 'copiado' }} · {{ files.portapapeles.paths.length }}
      </button>
    </div>

    <div class="tree rdp-scroll" role="tree">
      <div
        v-for="row in files.rows" :key="row.entry.path"
        class="row"
        :class="{
          dir: row.entry.kind === 'dir',
          root: row.depth === 0,
          cortado: files.portapapeles?.modo === 'cortar' && files.portapapeles.paths.includes(row.entry.path),
          encima: encima === row.entry.path,
        }"
        role="treeitem"
        :aria-expanded="row.entry.kind === 'dir' ? row.expanded : undefined"
        :style="{ paddingLeft: 6 + row.depth * 13 + 'px' }"
        :title="row.entry.path"
        @click="marcada = row.entry.path; alHacerClic(row)"
        @contextmenu.prevent.stop="abrirMenu($event, row)"
        @pointerdown="tocar($event, row)"
        @pointermove="mover"
        @pointerup="soltarDedo"
        @pointercancel="soltarDedo"
        @dragover.prevent.stop="encima = dirDestino(row)"
        @dragleave="encima = null"
        @drop.prevent.stop="soltarArchivos($event, dirDestino(row))"
      >
        <span class="twist">
          <Icon
            v-if="row.entry.kind === 'dir'"
            name="chevron" :size="13"
            :style="{ transform: row.expanded ? 'rotate(90deg)' : 'none' }"
          />
        </span>
        <Icon :name="row.entry.kind === 'dir' ? 'folder' : 'file'" :size="15" class="kind" />
        <span class="name">{{ row.entry.name }}</span>
        <button
          v-if="session.can('module:terminal')"
          class="here" title="Abrir una terminal aquí"
          @click.stop="openTerminalHere(row)"
        >
          <Icon name="terminal" :size="14" />
        </button>
        <!--
          Un botón visible y no solo el clic derecho: en tablet no hay clic
          derecho, y la pulsación larga no se descubre sola. Los dos abren lo
          mismo.
        -->
        <button
          class="here mas" title="Más acciones" aria-label="Más acciones"
          @click.stop="abrirMenu($event, row)"
        >⋯</button>
      </div>

      <div v-if="!files.rows.length" class="none">
        <p v-if="!workspaces.active">Abra un workspace para ver sus carpetas.</p>
        <p v-else>Este workspace no tiene carpetas disponibles.</p>
        <button @click="workspaces.pickerOpen = true">Seleccionar workspace</button>
      </div>

      <p v-if="files.error" class="err">{{ files.error }}</p>
    </div>

    <input
      ref="entrada" type="file" multiple class="oculto"
      @change="alElegirArchivos"
    >

    <p v-if="subiendo" class="estado">
      <Icon name="arriba" :size="13" />
      Subiendo {{ subiendo.hechos }} de {{ subiendo.total }}…
    </p>
    <p v-else-if="aviso" class="estado" :class="{ malo: avisoMalo }">
      <Icon :name="avisoMalo ? 'alert' : 'chevron'" :size="13" /> {{ aviso }}
    </p>

    <MenuContextual
      v-if="menu"
      :x="menu.x" :y="menu.y" :opciones="opciones"
      @elegir="elegir" @cerrar="menu = null"
    />
  </div>
</template>

<style scoped>
.explorer { display: flex; flex-direction: column; flex: 1; min-height: 0; }
/* Sin foco el panel no recibe el evento de pegado, pero el anillo del navegador
   sobre un contenedor entero se ve como un error. */
.explorer:focus { outline: none; }

.switcher {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  min-height: 34px; padding: 0 10px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-dim); text-align: left;
}
.switcher:hover { background: var(--bg-hover); color: var(--fg); }
.switcher .nm {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; font-weight: 600;
}
.switcher .count {
  padding: 0 6px; border-radius: 20px; background: var(--bg-active);
  font: 10.5px var(--mono); color: var(--fg-faint);
}

.herramientas {
  display: flex; align-items: center; gap: 2px; flex: 0 0 auto;
  padding: 4px 6px; border-bottom: 1px solid var(--border);
}
.herramientas button {
  display: grid; place-items: center; width: 28px; height: 28px;
  border-radius: 6px; color: var(--fg-faint);
}
.herramientas button:hover { background: var(--bg-hover); color: var(--fg); }
.herramientas .hueco { flex: 1; }
.herramientas .pp {
  width: auto; padding: 0 9px;
  background: var(--bg-active); border-radius: 20px;
  font: 10.5px var(--mono); color: var(--fg-dim);
}

.tree { flex: 1; min-height: 0; padding: 4px 0 12px; }

.row {
  display: flex; align-items: center; gap: 5px;
  /* Objetivo táctil: en iPad una fila de 22px no se acierta con el dedo. */
  min-height: var(--touch); padding-right: 4px;
  color: var(--fg-dim); cursor: pointer; user-select: none;
  /* Sin esto, mantener apretado en iOS abre el menú de selección del sistema
     encima del nuestro. */
  -webkit-touch-callout: none;
}
.row:hover { background: var(--bg-hover); color: var(--fg); }
.row.root { font-weight: 600; color: var(--fg); }
.row.cortado { opacity: .5; }
.row.encima { background: color-mix(in oklab, var(--accent) 22%, transparent); }

.twist { display: grid; place-items: center; width: 14px; flex: 0 0 14px; color: var(--fg-faint); }
.twist :deep(svg) { transition: transform .12s; }
.kind { flex: 0 0 auto; color: var(--fg-faint); }
.row.dir .kind { color: var(--accent); }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

.here {
  display: grid; place-items: center;
  width: 30px; height: 30px; flex: 0 0 30px;
  border-radius: 6px; color: var(--fg-faint); opacity: 0;
}
.here.mas { font-size: 16px; line-height: 1; }
.row:hover .here { opacity: 1; }
.here:hover { background: var(--bg-active); color: var(--fg); }
@media (pointer: coarse) { .here { opacity: .55; } }

.oculto { display: none; }

.none {
  display: flex; flex-direction: column; align-items: flex-start; gap: 9px;
  padding: 16px 14px;
}
.none p { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--fg-faint); }
.none button {
  padding: 6px 12px; border-radius: 7px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  font-size: 12.5px; color: var(--fg-dim);
}
.none button:hover { border-color: var(--accent); color: var(--accent); }

.err { margin: 12px; font-size: 12px; color: var(--warn); }

.estado {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  margin: 0; padding: 7px 12px calc(7px + var(--safe-b));
  border-top: 1px solid var(--border); background: var(--bg-surface);
  font: 11px var(--mono); color: var(--ok);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.estado.malo { color: var(--danger); white-space: normal; }
</style>
