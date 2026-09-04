<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '../../ui/Icon.vue';
import Markdown from '../../ui/Markdown.vue';

/**
 * Un mensaje de la conversación.
 *
 * El SDK emite casi cuarenta variantes de SDKMessage. Acá se renderizan las que
 * el usuario necesita ver —texto, uso de herramientas, resultados, pensamiento—
 * y el resto se ignora en silencio a propósito: mostrar cada evento interno
 * convertiría la conversación en un log.
 */
const props = defineProps<{ msg: any; cwd: string }>();

/** Qué llamadas a herramienta están desplegadas, por índice de bloque. */
const abiertos = ref(new Set<number>());
function alternar(i: number) {
  const s = new Set(abiertos.value);
  s.has(i) ? s.delete(i) : s.add(i);
  abiertos.value = s;
}

interface Tarea { content: string; status: string; activeForm?: string }

interface Bloque {
  kind: 'text' | 'thinking' | 'tool' | 'result' | 'todos';
  todos?: Tarea[];
  text?: string;
  name?: string;
  resumen?: string;
  completo?: string;
  isError?: boolean;
}

const rel = (p?: string) => (
  p && p.startsWith(props.cwd + '/') ? p.slice(props.cwd.length + 1) : p ?? ''
);

/** Una línea para la fila plegada. El detalle completo va aparte. */
function resumir(name: string, input: any): string {
  switch (name) {
    case 'Read': case 'Write': case 'Edit': return rel(input?.file_path);
    case 'Bash': return String(input?.command ?? '').split('\n')[0];
    case 'Glob': case 'Grep': return String(input?.pattern ?? '');
    case 'WebFetch': return String(input?.url ?? '');
    case 'Task': return String(input?.description ?? '');
    case 'AskUserQuestion': {
      const qs = input?.questions;
      if (!Array.isArray(qs) || !qs.length) return 'preguntas';
      return qs.length === 1
        ? String(qs[0]?.question ?? qs[0]?.header ?? 'una pregunta')
        : `${qs.length} preguntas: ${qs.map((q: any) => q?.header ?? '·').join(', ')}`;
    }
    default: {
      // Un valor estructurado se resume, no se convierte a texto: `String({})`
      // da "[object Object]", que no le dice nada a nadie.
      const first = input && typeof input === 'object' ? Object.values(input)[0] : input;
      if (first === null || first === undefined) return '';
      if (typeof first === 'object') return JSON.stringify(first).slice(0, 140);
      return String(first);
    }
  }
}

/** Lo que se ve al desplegar: el comando entero, o los argumentos completos. */
function detallar(name: string, input: any): string {
  if (name === 'AskUserQuestion') {
    const qs = input?.questions ?? [];
    return qs.map((q: any, i: number) => {
      const ops = (q.options ?? []).map((o: any) => `  - ${o.label}${o.description ? `: ${o.description}` : ''}`);
      const resp = input?.answers?.[q.question];
      return [
        `${i + 1}. ${q.question}${q.multiSelect ? '  (varias)' : ''}`,
        ...ops,
        resp ? `  → ${resp}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  }
  if (name === 'Bash') {
    const cmd = String(input?.command ?? '');
    return input?.description ? `# ${input.description}\n${cmd}` : cmd;
  }
  if ((name === 'Write' || name === 'Edit') && (input?.content || input?.new_string)) {
    return `${rel(input.file_path)}\n\n${input.content ?? input.new_string}`;
  }
  return JSON.stringify(input ?? {}, null, 2);
}

const bloques = computed<Bloque[]>(() => {
  const contenido = props.msg?.message?.content;
  if (!Array.isArray(contenido)) {
    return typeof contenido === 'string' && contenido.trim()
      ? [{ kind: 'text', text: contenido }]
      : [];
  }
  const out: Bloque[] = [];
  for (const b of contenido) {
    if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', text: b.text });
    else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ kind: 'thinking', text: b.thinking });
    else if (b.type === 'tool_use') {
      out.push({
        kind: 'tool',
        name: b.name,
        resumen: resumir(b.name, b.input),
        completo: detallar(b.name, b.input),
      });
    } else if (b.type === 'tool_result') {
      const c = b.content;
      const texto = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n')
        : '';
      if (texto.trim()) out.push({ kind: 'result', text: texto, isError: !!b.is_error });
    }
  }
  return out;
});

/** Un mensaje del usuario es el que escribió una persona, no un resultado de herramienta. */
const esUsuario = computed(() => (
  props.msg?.type === 'user' && bloques.value.length > 0 && bloques.value.every((b) => b.kind === 'text')
));
</script>

<template>
  <div v-if="bloques.length" class="msg" :class="{ mine: esUsuario }">
    <template v-for="(b, i) in bloques" :key="i">
      <div v-if="b.kind === 'text' && esUsuario" class="burbuja">{{ b.text }}</div>
      <Markdown v-else-if="b.kind === 'text'" :source="b.text!" />

      <details v-else-if="b.kind === 'thinking'" class="thinking">
        <summary><Icon name="claude" :size="12" /> pensando</summary>
        <div class="cita">{{ b.text }}</div>
      </details>

      <div v-else-if="b.kind === 'tool'" class="tool" :class="{ open: abiertos.has(i) }">
        <button class="cabeza" @click="alternar(i)">
          <Icon :name="b.name === 'Bash' ? 'terminal' : 'file'" :size="13" />
          <strong>{{ b.name }}</strong>
          <code>{{ b.resumen }}</code>
          <Icon name="chevron" :size="12" class="caret" />
        </button>
        <pre v-if="abiertos.has(i)" class="detalle">{{ b.completo }}</pre>
      </div>

      <ul v-else-if="b.kind === 'todos'" class="todos">
        <li v-for="(t, j) in b.todos" :key="j" :class="t.status">
          <span class="caja">
            <Icon v-if="t.status === 'completed'" name="chevron" :size="10" />
            <span v-else-if="t.status === 'in_progress'" class="punto" />
          </span>
          {{ t.status === 'in_progress' ? (t.activeForm || t.content) : t.content }}
        </li>
      </ul>

      <details v-else-if="b.kind === 'result'" class="result" :class="{ bad: b.isError }">
        <summary>
          <Icon :name="b.isError ? 'alert' : 'chevron'" :size="11" />
          {{ b.isError ? 'la herramienta falló' : 'resultado' }}
          <em>{{ b.text!.split('\n').length }} líneas</em>
        </summary>
        <pre>{{ b.text!.slice(0, 6000) }}</pre>
      </details>
    </template>
  </div>
</template>

<style scoped>
.msg { display: flex; flex-direction: column; gap: 8px; align-items: stretch; max-width: 54rem; }

/* Lo que escribe el usuario va a la derecha, como en un chat: se distingue de
   un vistazo sin leerlo. Lo de Claude ocupa el ancho, que es un documento. */
.msg.mine { align-items: flex-end; align-self: flex-end; max-width: min(42rem, 88%); }
.burbuja {
  padding: 9px 13px; border-radius: 13px 13px 4px 13px;
  background: var(--bubble);
  white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6;
}

.thinking summary, .result summary {
  display: flex; align-items: center; gap: 6px;
  min-height: 24px; cursor: pointer; list-style: none;
  font-size: .86em; color: var(--fg-faint);
}
.thinking summary::-webkit-details-marker, .result summary::-webkit-details-marker { display: none; }
.thinking summary:hover, .result summary:hover { color: var(--fg-dim); }
.cita {
  margin-top: 4px; padding-left: 11px; border-left: 2px solid var(--border);
  white-space: pre-wrap; font-size: .9em; line-height: 1.6; color: var(--fg-faint);
}
.result em { font-style: normal; opacity: .7; }
.result pre, .detalle {
  margin: 5px 0 0; padding: 10px 12px; max-height: 24rem; overflow: auto;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 9px;
  font: .86em/1.55 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere;
}
.result.bad summary { color: var(--danger); }

/* Sin relleno gris: solo el borde. Una llamada a herramienta acompaña al texto,
   no compite con él. */
.todos {
  display: flex; flex-direction: column; gap: 2px;
  margin: 0; padding: 9px 11px; list-style: none;
  border: 1px solid var(--border); border-radius: 9px;
}
.todos li {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: .92em; line-height: 1.5; color: var(--fg-dim);
}
.todos li.completed { color: var(--fg-faint); text-decoration: line-through; text-decoration-color: var(--border-strong); }
.todos li.in_progress { color: var(--fg); font-weight: 550; }
.caja {
  display: grid; place-items: center; flex: 0 0 14px;
  width: 14px; height: 14px; margin-top: 2px;
  border: 1px solid var(--border-strong); border-radius: 4px;
}
.todos li.completed .caja { background: var(--ok); border-color: var(--ok); color: var(--bg); }
.todos li.in_progress .caja { border-color: var(--accent); }
.caja .punto { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

.tool { border: 1px solid var(--border); border-radius: 9px; }
.tool.open { border-color: var(--border-strong); }
.cabeza {
  display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0;
  padding: 6px 9px; text-align: left;
  font-size: .88em; color: var(--fg-dim);
}
.cabeza:hover { color: var(--fg); }
.cabeza > :deep(svg:first-child) { flex: 0 0 auto; color: var(--accent); }
.cabeza strong { flex: 0 0 auto; font-weight: 600; }
.cabeza code {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: .95em var(--mono); color: var(--fg-faint);
}
.caret { flex: 0 0 auto; opacity: .45; transition: transform .15s; }
.tool.open .caret { transform: rotate(90deg); }
.detalle { margin: 0; border: 0; border-top: 1px solid var(--border); border-radius: 0 0 8px 8px; }
</style>
