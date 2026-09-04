<script setup lang="ts">
import { ref, computed } from 'vue';
import Markdown from './Markdown.vue';
import type { PermissionAsk } from './useClaudeSocket';

/**
 * Las preguntas de Claude, contestadas en la interfaz.
 *
 * `AskUserQuestion` es una herramienta integrada, y no alcanza con permitirla:
 * sus respuestas vuelven dentro de su propio input, en el campo `answers`
 * —"answers collected by the permission component"—. Permitirla a secas la
 * ejecuta sin nadie que conteste, y Claude recibe "the user did not answer the
 * questions".
 *
 * Una pestaña por pregunta: casi siempre hay una sola, y cuando hay varias no
 * conviene apilarlas encima de la caja de texto.
 */
const props = defineProps<{ ask: PermissionAsk }>();
const emit = defineEmits<{
  (e: 'answer', answers: Record<string, string>): void;
  (e: 'cancel'): void;
}>();

interface Opcion { label: string; description?: string; preview?: string }
interface Pregunta {
  question: string;
  header?: string;
  options: Opcion[];
  multiSelect?: boolean;
}

const preguntas = computed<Pregunta[]>(() => {
  const q = (props.ask.input as any)?.questions;
  return Array.isArray(q) ? q : [];
});

const activa = ref(0);
/** Respuestas por índice de pregunta. Un Set porque multiSelect admite varias. */
const elegidas = ref<Record<number, Set<string>>>({});
/** Texto libre cuando ninguna opción sirve. La UI de Claude siempre lo ofrece. */
const otros = ref<Record<number, string>>({});
/** Los previews ocupan mucho: se muestran solo si se piden. */
const previews = ref(new Set<string>());
function alternarPreview(label: string) {
  const s = new Set(previews.value);
  s.has(label) ? s.delete(label) : s.add(label);
  previews.value = s;
}

function seleccion(i: number) {
  return elegidas.value[i] ?? new Set<string>();
}

function alternar(i: number, label: string, multi: boolean) {
  const actual = new Set(seleccion(i));
  if (multi) {
    actual.has(label) ? actual.delete(label) : actual.add(label);
  } else {
    actual.clear();
    actual.add(label);
  }
  elegidas.value = { ...elegidas.value, [i]: actual };
  if (multi) return;

  otros.value = { ...otros.value, [i]: '' };
  /*
   * Con una sola opción, elegir ya cierra la pregunta: se pasa a la siguiente.
   * Con casillas no, porque seguís marcando.
   *
   * El salto va con un retraso corto a propósito: sin él la pestaña cambia en
   * el mismo instante del clic y no se llega a ver qué quedó elegido.
   */
  if (i < preguntas.value.length - 1) {
    setTimeout(() => { if (activa.value === i) activa.value = i + 1; }, 220);
  }
}

function respuestaDe(i: number): string {
  const libre = (otros.value[i] ?? '').trim();
  if (libre) return libre;
  return [...seleccion(i)].join(', ');
}

const completas = computed(() => preguntas.value.every((_, i) => !!respuestaDe(i)));
const faltan = computed(() => preguntas.value.filter((_, i) => !respuestaDe(i)).length);

function enviar() {
  if (!completas.value) return;
  const answers: Record<string, string> = {};
  preguntas.value.forEach((p, i) => { answers[p.question] = respuestaDe(i); });
  emit('answer', answers);
}
</script>

<template>
  <div class="preguntas">
    <header v-if="preguntas.length > 1" class="tabs" role="tablist">
      <button
        v-for="(p, i) in preguntas" :key="i"
        class="tab" :class="{ on: activa === i }"
        role="tab" :aria-selected="activa === i"
        @click="activa = i"
      >
        <span class="bolita" :class="{ listo: !!respuestaDe(i) }" />
        {{ p.header || `Pregunta ${i + 1}` }}
      </button>
    </header>

    <div class="cuerpo">
      <div v-for="(p, i) in preguntas" v-show="activa === i" :key="i" class="pregunta">
        <p class="texto">
          {{ p.question }}
          <span v-if="p.multiSelect" class="varias">varias</span>
        </p>

        <div class="ops" :role="p.multiSelect ? 'group' : 'radiogroup'">
          <div v-for="o in p.options" :key="o.label" class="opWrap">
            <label class="op" :class="{ on: seleccion(i).has(o.label) }">
              <input
                :type="p.multiSelect ? 'checkbox' : 'radio'" :name="`q${i}`"
                :checked="seleccion(i).has(o.label)"
                @change="alternar(i, o.label, !!p.multiSelect)"
              >
              <span class="txt">
                <strong>{{ o.label }}</strong>
                <em v-if="o.description">{{ o.description }}</em>
              </span>
              <button
                v-if="o.preview" class="verPreview" type="button"
                :aria-expanded="previews.has(o.label)"
                @click.prevent="alternarPreview(o.label)"
              >{{ previews.has(o.label) ? 'ocultar' : 'ejemplo' }}</button>
            </label>
            <Markdown v-if="o.preview && previews.has(o.label)" class="preview" :source="o.preview" />
          </div>

          <label class="op otra" :class="{ on: !!(otros[i] ?? '').trim() }">
            <input
              type="radio" :name="`q${i}`" :checked="!!(otros[i] ?? '').trim()"
              @change="elegidas = { ...elegidas, [i]: new Set() }"
            >
            <input
              class="libre" placeholder="Otra cosa…"
              :value="otros[i] ?? ''"
              @input="otros = { ...otros, [i]: ($event.target as HTMLInputElement).value }"
              @focus="elegidas = { ...elegidas, [i]: new Set() }"
            >
          </label>
        </div>
      </div>
    </div>

    <footer>
      <span v-if="faltan" class="faltan">falta{{ faltan > 1 ? 'n' : '' }} {{ faltan }}</span>
      <button class="cancelar" @click="emit('cancel')">Cancelar</button>
      <button class="enviar" :disabled="!completas" @click="enviar">Responder</button>
    </footer>
  </div>
</template>

<style scoped>
/*
/*
 * Un piso y un techo, y poder encogerse entre medio.
 *
 * Sin `flex-shrink` un bloque largo empuja al compositor fuera de la pantalla.
 * Pero shrink sin piso es peor: el hilo se queda con el espacio y las preguntas
 * quedan en una rendija que se lee línea por línea. El piso hace que el hilo
 * ceda primero — tiene su propio scroll, así que achicarse no le duele.
 *
 * dvh y no vh: en iPad la barra del navegador entra y sale, y vh mide el
 * viewport grande, así que un tope en vh puede ser más que todo lo visible.
 */
.preguntas {
  display: flex; flex-direction: column;
  flex: 0 1 auto;
  min-height: min(22rem, 50dvh);
  max-height: 62dvh;
  background: var(--bg-panel); border-top: 1px solid var(--border);
}

/* Las pestañas quedan fijas: con una lista larga de opciones, perderlas al
   desplazarse deja sin forma de saltar a la otra pregunta. */
.tabs {
  position: sticky; top: 0; z-index: 2;
  display: flex; gap: 14px; flex: 0 0 auto;
  padding: 10px 14px 0;
  background: var(--bg-panel);
}
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 0 0 8px; border-bottom: 2px solid transparent;
  font-size: 12.5px; color: var(--fg-faint);
}
.tab:hover { color: var(--fg-dim); }
.tab.on { color: var(--fg); font-weight: 600; border-bottom-color: var(--accent); }
.bolita {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--border-strong); transition: background .15s;
}
.bolita.listo { background: var(--ok); }

/* El único que scrollea: las pestañas quedan fijas arriba y el pie abajo. */
.cuerpo {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain;
  padding: 12px 14px 6px;
}

.pregunta { display: flex; flex-direction: column; gap: 10px; }
.texto {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin: 0; font-size: 14px; font-weight: 600; line-height: 1.45;
}
.varias {
  padding: 1px 7px; border-radius: 20px; background: var(--bg-surface);
  font-size: 10px; font-weight: 500; letter-spacing: .04em;
  text-transform: uppercase; color: var(--fg-faint);
}

.ops { display: flex; flex-direction: column; }
.opWrap { display: flex; flex-direction: column; }

/*
 * Filas, no tarjetas. Con cinco opciones y descripciones, encerrar cada una en
 * su caja llena la pantalla de bordes y no ayuda a leer. La elegida se marca
 * con una barra al costado y un tinte, que alcanza.
 */
.op {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 11px; border-radius: 8px;
  border-left: 2px solid transparent;
  cursor: pointer; transition: background .12s;
}
.op:hover { background: var(--bg-hover); }
.op.on { background: color-mix(in oklab, var(--accent) 8%, transparent); border-left-color: var(--accent); }
.op input[type="radio"], .op input[type="checkbox"] {
  width: 15px; height: 15px; flex: 0 0 15px; margin-top: 2px; accent-color: var(--accent);
}
.txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.txt strong { font-size: 13px; font-weight: 550; }
.op.on .txt strong { font-weight: 650; }
.txt em { font-style: normal; font-size: 11.5px; line-height: 1.5; color: var(--fg-faint); }

.verPreview {
  flex: 0 0 auto; align-self: center; padding: 2px 8px; border-radius: 20px;
  font-size: 10.5px; color: var(--fg-faint); border: 1px solid var(--border);
}
.verPreview:hover { color: var(--accent); border-color: var(--accent); }

.preview {
  margin: 0 0 6px 34px; padding: 9px 11px; max-height: 15rem; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  font-size: 11.5px;
}

.otra { align-items: center; }
.libre {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px;
  font-size: 12.5px;
}
.libre:focus { outline: none; border-color: var(--accent); }

footer {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 10px 14px; border-top: 1px solid var(--border);
}
.faltan { flex: 1; font-size: 11.5px; color: var(--warn); }
.cancelar {
  margin-left: auto; height: 32px; padding: 0 12px; border-radius: 8px;
  color: var(--fg-faint); font-size: 12.5px;
}
.cancelar:hover { color: var(--danger); }
.enviar {
  height: 32px; padding: 0 16px; border-radius: 8px;
  background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 12.5px;
}
.enviar:disabled { background: var(--bg-active); color: var(--fg-faint); cursor: default; }
</style>
