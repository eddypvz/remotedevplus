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
import { useSession } from '../../stores/session';
import { useSettings } from '../../stores/settings';
import { temaEditor } from './tema';
import { lenguajeDe, nombreLenguaje } from './lenguajes';

/**
 * Visor y editor de archivos, sobre CodeMirror 6.
 *
 * CodeMirror y no Monaco: Monaco es justamente por qué code-server se siente
 * mal en iPad —pesa unos 5MB, no tiene selección táctil real y pelea con el
 * teclado virtual—. CodeMirror es un orden de magnitud más liviano y trae
 * soporte táctil de fábrica, que es el punto entero de este proyecto.
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
  try {
    const r = await api.get<{ content: string; encoding: string; size: number }>(
      `/api/fs/read?path=${q(props.ctx.path!)}`,
    );
    encoding.value = r.encoding;
    size.value = r.size;
    if (r.encoding === 'binary') { cargando.value = false; return; }

    const lang = await lenguajeDe(props.ctx.path!);
    compartimento.lenguaje = lang ? [lang] : [];

    cargando.value = false;
    await nextTick();
    vista.value?.destroy();
    vista.value = new EditorView({
      state: EditorState.create({
        doc: r.content,
        extensions: [...extensionesBase(), ...compartimento.lenguaje],
      }),
      parent: host.value!,
    });

    // Abierto desde el buscador: se salta a la línea y se deja centrada, no
    // pegada al borde de arriba donde no se ve el contexto.
    if (props.ctx.linea) irALinea(props.ctx.linea);
  } catch (e: any) {
    error.value = e?.message || 'No se pudo leer el archivo';
    cargando.value = false;
  }
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
      <button
        v-if="!soloLectura && encoding === 'utf8'"
        class="save" :disabled="!sucio || guardando" @click="guardar"
      >{{ guardando ? 'guardando…' : 'guardar' }}</button>
    </div>

    <Loading v-if="cargando" />
    <Empty v-else-if="error" icon="alert" title="No se pudo abrir" :hint="error" />
    <Empty
      v-else-if="encoding === 'binary'"
      icon="file" title="Archivo binario"
      :hint="`${size.toLocaleString('es')} bytes. No hay nada que mostrar como texto.`"
    />

    <div v-show="!cargando && !error && encoding === 'utf8'" ref="host" class="editor" />

    <div v-if="!cargando && encoding === 'utf8' && !error" class="pie">
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
