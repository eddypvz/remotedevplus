<script setup lang="ts">
import { ref, shallowRef, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { foldGutter, foldKeymap, indentOnInput, bracketMatching, indentUnit } from '@codemirror/language';
import { api, q } from '../../api';
import Icon from '../../ui/Icon.vue';
import Empty from '../../ui/Empty.vue';
import Loading from '../../ui/Loading.vue';
import Markdown from '../../ui/Markdown.vue';
import { useSession } from '../../stores/session';
import { useSettings } from '../../stores/settings';
import { temaEditor } from './tema';
import { lenguajeDe, nombreLenguaje } from './lenguajes';

/**
 * Visor y editor de archivos.
 *
 * No todo archivo se lee igual. Un README quiere verse formateado, una captura
 * quiere verse, y un `.ts` quiere un editor. Por eso esto despacha por tipo en
 * vez de meter todo en CodeMirror: abrir un PNG y encontrarse con "archivo
 * binario" es la clase de detalle que hace que una herramienta se sienta pobre.
 *
 * El editor es CodeMirror 6 y no Monaco: Monaco es justamente por qué
 * code-server se siente mal en iPad —pesa unos 5MB, no tiene selección táctil
 * real y pelea con el teclado virtual—. CodeMirror es un orden de magnitud más
 * liviano y trae soporte táctil de fábrica.
 */
const props = defineProps<{ ctx: { path?: string; linea?: number }; active: boolean }>();

const session = useSession();
const settings = useSettings();

const host = ref<HTMLDivElement>();
const vista = shallowRef<EditorView | null>(null);
const cargando = ref(true);
const error = ref('');
const encoding = ref('utf8');
const size = ref(0);
const sucio = ref(false);
const guardando = ref(false);
const cursor = ref({ linea: 1, columna: 1 });

const soloLectura = computed(() => !session.can('fs:write'));
const lenguaje = computed(() => (props.ctx.path ? nombreLenguaje(props.ctx.path) : ''));

/* ---------- qué clase de archivo es ---------- */

const IMAGENES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'];

const extension = computed(() => {
  const nombre = (props.ctx.path ?? '').split('/').pop() ?? '';
  const punto = nombre.lastIndexOf('.');
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : '';
});

const clase = computed<'imagen' | 'pdf' | 'markdown' | 'texto'>(() => {
  const e = extension.value;
  if (IMAGENES.includes(e)) return 'imagen';
  if (e === 'pdf') return 'pdf';
  if (e === 'md' || e === 'markdown' || e === 'mdx') return 'markdown';
  return 'texto';
});

/** Lo que no es texto se sirve por su propia ruta, sin pasar por el editor. */
const urlCruda = computed(() => `/api/fs/raw?path=${q(props.ctx.path ?? '')}`);

/**
 * Vista formateada o editor.
 *
 * El markdown arranca formateado —que es el pedido: que un README se abra
 * bonito— y se puede pasar a editor sin cerrar nada. La preferencia NO se
 * recuerda entre archivos: abrir un README casi siempre es para leerlo, aunque
 * el anterior se haya editado.
 */
const modo = ref<'vista' | 'editor'>('vista');
const puedeAlternar = computed(() => clase.value === 'markdown' && encoding.value === 'utf8');
const mostrandoEditor = computed(() => !puedeAlternar.value || modo.value === 'editor');

/** El texto que se formatea: el del editor si ya se tocó, si no el del disco. */
const textoOriginal = ref('');
const textoMarkdown = computed(() => vista.value?.state.doc.toString() ?? textoOriginal.value);

/** Zoom de la imagen: ajustada al panel, o a tamaño real con scroll. */
const imagenAjustada = ref(true);

/** Compartimentos: cambian sin recrear el editor ni perder el historial de deshacer. */
const compartimento = { lenguaje: [] as Extension[] };

function extensionesBase(): Extension[] {
  return [
    lineNumbers(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    search({ top: true }),
    indentUnit.of('  '),
    EditorState.allowMultipleSelections.of(true),
    // indentWithTab va al final: debe ganarle al keymap por defecto.
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
    temaEditor,
    EditorView.lineWrapping,
    EditorState.readOnly.of(soloLectura.value),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) sucio.value = true;
      if (u.selectionSet || u.docChanged) {
        const pos = u.state.selection.main.head;
        const linea = u.state.doc.lineAt(pos);
        cursor.value = { linea: linea.number, columna: pos - linea.from + 1 };
      }
    }),
  ];
}

async function abrir() {
  cargando.value = true;
  error.value = '';
  sucio.value = false;
  modo.value = 'vista';
  imagenAjustada.value = true;
  vista.value?.destroy();
  vista.value = null;

  // Una imagen o un PDF no se leen como texto: el navegador los pide por su
  // cuenta a `/api/fs/raw`. Bajar un JPEG de 4MB en base64 para tirarlo sería
  // absurdo, y en una tablet por wifi se nota.
  if (clase.value === 'imagen' || clase.value === 'pdf') {
    encoding.value = 'binary';
    cargando.value = false;
    return;
  }

  try {
    const r = await api.get<{ content: string; encoding: string; size: number }>(
      `/api/fs/read?path=${q(props.ctx.path!)}`,
    );
    encoding.value = r.encoding;
    size.value = r.size;
    textoOriginal.value = r.content;
    if (r.encoding === 'binary') { cargando.value = false; return; }

    const lang = await lenguajeDe(props.ctx.path!);
    compartimento.lenguaje = lang ? [lang] : [];

    cargando.value = false;
    await nextTick();

    // Un markdown arranca formateado, así que el editor todavía no existe. Se
    // crea al pasar a modo editor.
    if (puedeAlternar.value) return;
    montarEditor(r.content);

    // Abierto desde el buscador: se salta a la línea.
    if (props.ctx.linea) irALinea(props.ctx.linea);
  } catch (e: any) {
    error.value = e?.message || 'No se pudo leer el archivo';
    cargando.value = false;
  }
}

function montarEditor(contenido: string) {
  vista.value?.destroy();
  vista.value = new EditorView({
    state: EditorState.create({
      doc: contenido,
      extensions: [...extensionesBase(), ...compartimento.lenguaje],
    }),
    parent: host.value!,
  });
  host.value!.style.fontSize = settings.fontSize + 'px';
}

/**
 * Alterna entre leer y editar.
 *
 * El editor se crea la primera vez que hace falta y de ahí en más se conserva:
 * destruirlo al volver a la vista perdería el historial de deshacer y los
 * cambios sin guardar.
 */
async function alternar() {
  modo.value = modo.value === 'vista' ? 'editor' : 'vista';
  if (modo.value !== 'editor') return;
  await nextTick();
  if (!vista.value) montarEditor(textoOriginal.value);
  nextTick(() => vista.value?.focus());
}

function irALinea(n: number) {
  const v = vista.value;
  if (!v) return;
  const total = v.state.doc.lines;
  const linea = v.state.doc.line(Math.min(Math.max(n, 1), total));
  v.dispatch({
    selection: { anchor: linea.from },
    effects: EditorView.scrollIntoView(linea.from, { y: 'center' }),
  });
  v.focus();
}

async function guardar() {
  if (!vista.value || soloLectura.value || !sucio.value) return;
  guardando.value = true;
  try {
    await api.put('/api/fs/write', {
      path: props.ctx.path,
      content: vista.value.state.doc.toString(),
    });
    sucio.value = false;
  } catch (e: any) {
    error.value = e?.message || 'No se pudo guardar';
  } finally {
    guardando.value = false;
  }
}

/** Igual que en el explorador: un ancla temporal, para no mover la página. */
function descargar() {
  const a = document.createElement('a');
  a.href = `/api/fs/download?path=${q(props.ctx.path ?? '')}`;
  a.download = (props.ctx.path ?? '').split('/').pop() ?? 'archivo';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function atajoGuardar(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    guardar();
  }
}

watch(() => props.ctx.path, abrir, { immediate: true });

// Volver a abrir el mismo archivo desde otro resultado solo mueve el cursor.
watch(() => props.ctx.linea, (n) => { if (n && vista.value) irALinea(n); });

// El tamaño de letra sale de los ajustes, igual que el terminal y el chat.
watch(() => settings.fontSize, () => {
  if (host.value) host.value.style.fontSize = settings.fontSize + 'px';
}, { immediate: true });

// Al volver a la pestaña hay que devolverle el foco: estuvo con display:none.
watch(() => props.active, (a) => { if (a) nextTick(() => vista.value?.focus()); });

onBeforeUnmount(() => vista.value?.destroy());
</script>

<template>
  <div class="file" @keydown="atajoGuardar">
    <div class="head">
      <span class="path" :title="props.ctx.path">{{ props.ctx.path }}</span>
      <span v-if="sucio" class="dot" title="Sin guardar" />

      <!-- Leer o editar. Solo aparece donde hay dos formas de ver lo mismo. -->
      <div v-if="puedeAlternar" class="alterna" role="group">
        <button :class="{ on: modo === 'vista' }" @click="modo !== 'vista' && alternar()">vista</button>
        <button :class="{ on: modo === 'editor' }" @click="modo !== 'editor' && alternar()">editor</button>
      </div>

      <button
        v-if="clase === 'imagen'" class="chico"
        :title="imagenAjustada ? 'Ver a tamaño real' : 'Ajustar al panel'"
        @click="imagenAjustada = !imagenAjustada"
      >{{ imagenAjustada ? '1:1' : 'ajustar' }}</button>

      <button
        v-if="clase === 'imagen' || clase === 'pdf'" class="chico"
        title="Descargar" @click="descargar"
      ><Icon name="abajo" :size="14" /></button>

      <button
        v-if="!soloLectura && encoding === 'utf8' && mostrandoEditor"
        class="save" :disabled="!sucio || guardando" @click="guardar"
      >{{ guardando ? 'guardando…' : 'guardar' }}</button>
    </div>

    <Loading v-if="cargando" />
    <Empty v-else-if="error" icon="alert" title="No se pudo abrir" :hint="error" />

    <!-- Imagen -->
    <div v-else-if="clase === 'imagen'" class="lienzo rdp-scroll" :class="{ ajustada: imagenAjustada }">
      <img :src="urlCruda" :alt="props.ctx.path" @error="error = 'No se pudo cargar la imagen'">
    </div>

    <!--
      PDF en un iframe y no un visor propio: el del navegador ya sabe paginar,
      buscar y hacer zoom con dos dedos, y en iPad eso funciona mejor que
      cualquier cosa que pudiéramos escribir.
    -->
    <iframe v-else-if="clase === 'pdf'" class="pdf" :src="urlCruda" :title="props.ctx.path" />

    <Empty
      v-else-if="encoding === 'binary'"
      icon="file" title="Archivo binario"
      :hint="`${size.toLocaleString('es')} bytes. No hay nada que mostrar como texto.`"
    />

    <!-- Markdown formateado -->
    <div v-show="puedeAlternar && modo === 'vista' && !cargando && !error" class="lectura rdp-scroll">
      <Markdown :source="textoMarkdown" :duros="false" documento />
    </div>

    <div
      v-show="!cargando && !error && encoding === 'utf8' && mostrandoEditor"
      ref="host" class="editor"
    />

    <div v-if="!cargando && !error && encoding === 'utf8' && mostrandoEditor" class="pie">
      <span>{{ lenguaje }}</span>
      <span>línea {{ cursor.linea }}, columna {{ cursor.columna }}</span>
      <span v-if="soloLectura" class="ro"><Icon name="alert" :size="11" /> solo lectura</span>
      <span class="hueco" />
      <span>{{ size.toLocaleString('es') }} bytes</span>
    </div>
  </div>
</template>

<style scoped>
.file { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.head {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 5px 12px; border-bottom: 1px solid var(--border); background: var(--bg-panel);
}
.path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; direction: rtl; text-align: left;
  font: 12px var(--mono); color: var(--fg-faint);
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: 0 0 7px; }
.save { padding: 4px 11px; border-radius: 6px; background: var(--bg-active); color: var(--fg); font-size: 12px; }
.save:disabled { opacity: .4; cursor: default; }

/* Segmentado, no un interruptor: los dos estados tienen nombre y se ven. */
.alterna {
  display: flex; flex: 0 0 auto; padding: 2px;
  background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
}
.alterna button {
  padding: 3px 11px; border-radius: 6px;
  font-size: 11.5px; color: var(--fg-faint);
}
.alterna button.on { background: var(--bg-active); color: var(--fg); font-weight: 600; }

.chico {
  display: grid; place-items: center; flex: 0 0 auto;
  min-width: 28px; height: 26px; padding: 0 8px;
  border-radius: 6px; color: var(--fg-faint); font: 11px var(--mono);
}
.chico:hover { background: var(--bg-active); color: var(--fg); }

.lectura { flex: 1; min-height: 0; background: var(--bg); }

.lienzo {
  display: grid; place-items: center;
  flex: 1; min-height: 0; padding: 16px;
  background: var(--bg);
  /* Un damero detrás: sin esto un PNG con transparencia no se distingue del
     fondo del panel, y no se sabe si el archivo tiene fondo o no. */
  background-image:
    linear-gradient(45deg, var(--bg-surface) 25%, transparent 25%),
    linear-gradient(-45deg, var(--bg-surface) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--bg-surface) 75%),
    linear-gradient(-45deg, transparent 75%, var(--bg-surface) 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}
.lienzo img { display: block; max-width: none; }
.lienzo.ajustada img { max-width: 100%; max-height: 100%; object-fit: contain; }

.pdf { flex: 1; min-height: 0; width: 100%; border: 0; background: var(--bg); }

.editor { flex: 1; min-height: 0; overflow: hidden; }
.editor :deep(.cm-editor) { height: 100%; }

.pie {
  display: flex; align-items: center; gap: 14px; flex: 0 0 auto;
  padding: 4px 12px calc(4px + var(--safe-b));
  border-top: 1px solid var(--border); background: var(--bg-panel);
  font: 11px var(--mono); color: var(--fg-faint);
}
.hueco { flex: 1; }
.ro { display: flex; align-items: center; gap: 4px; color: var(--warn); }
</style>
