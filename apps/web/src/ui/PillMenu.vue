<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';

export interface PillOption {
  id: string;
  label: string;
  hint?: string;
  dangerous?: boolean;
}

/**
 * Un control compacto con menú.
 *
 * Reemplaza a un `<select>` nativo por dos razones: un select solo muestra la
 * etiqueta de la opción, así que dos seguidos decían "El del sistema" y "El del
 * sistema" sin decir de qué; y no deja poner un icono ni una descripción de
 * cada opción, que es justo lo que hace falta para elegir un modo de permisos.
 */
const props = defineProps<{
  modelValue: string;
  options: PillOption[];
  icon?: string;
  /** Qué se muestra cuando la opción elegida es la neutra. */
  fallbackLabel?: string;
  label: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const abierto = ref(false);
const raiz = ref<HTMLElement>();

const actual = computed(() => props.options.find((o) => o.id === props.modelValue));
const texto = computed(() => (
  props.modelValue === 'default' && props.fallbackLabel
    ? props.fallbackLabel
    : actual.value?.label ?? props.fallbackLabel ?? '—'
));

function elegir(id: string) {
  abierto.value = false;
  if (id !== props.modelValue) emit('update:modelValue', id);
}

function afuera(e: MouseEvent) {
  if (abierto.value && raiz.value && !raiz.value.contains(e.target as Node)) abierto.value = false;
}
function escape(e: KeyboardEvent) {
  if (e.key === 'Escape') abierto.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', afuera);
  document.addEventListener('keydown', escape);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', afuera);
  document.removeEventListener('keydown', escape);
});
</script>

<template>
  <div ref="raiz" class="pill-root">
    <button
      class="pill" :class="{ risky: actual?.dangerous, on: abierto }"
      :disabled="props.disabled"
      :aria-label="`${props.label}: ${texto}`"
      :aria-expanded="abierto"
      :title="`${props.label} — ${actual?.hint ?? texto}`"
      @click="abierto = !abierto"
    >
      <Icon v-if="props.icon" :name="props.icon" :size="13" />
      <span>{{ texto }}</span>
      <Icon name="chevron" :size="11" class="caret" />
    </button>

    <div v-if="abierto" class="menu" role="listbox" :aria-label="props.label">
      <p class="cabeza">{{ props.label }}</p>
      <button
        v-for="o in props.options" :key="o.id"
        class="opt" :class="{ on: o.id === props.modelValue, risky: o.dangerous }"
        role="option" :aria-selected="o.id === props.modelValue"
        @click="elegir(o.id)"
      >
        <span class="marca"><Icon v-if="o.id === props.modelValue" name="chevron" :size="11" /></span>
        <span class="cuerpo">
          <strong>{{ o.label }}</strong>
          <em v-if="o.hint">{{ o.hint }}</em>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pill-root { position: relative; flex: 0 0 auto; }

.pill {
  display: flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 8px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 9px; font-size: 12px; color: var(--fg-dim);
  white-space: nowrap;
}
.pill:hover:not(:disabled), .pill.on { color: var(--fg); border-color: var(--accent); }
.pill:disabled { opacity: .5; cursor: default; }
.pill.risky { border-color: var(--warn); color: var(--warn); }
.pill > :deep(svg:first-child) { flex: 0 0 auto; opacity: .8; }
.caret { transform: rotate(90deg); opacity: .5; }

.menu {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 1px;
  width: max-content; min-width: 13rem; max-width: min(22rem, 82vw);
  max-height: 60dvh; overflow: auto; padding: 5px;
  background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: 11px; box-shadow: 0 14px 36px var(--shadow);
}
.cabeza {
  margin: 2px 0 4px; padding: 0 8px;
  font-size: 10.5px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: var(--fg-faint);
}

.opt {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 7px 8px; border-radius: 7px; text-align: left;
}
.opt:hover { background: var(--bg-hover); }
.opt .marca { display: grid; place-items: center; width: 13px; flex: 0 0 13px; padding-top: 2px; color: var(--accent); }
.opt .cuerpo { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.opt strong { font-size: 12.5px; font-weight: 550; color: var(--fg-dim); }
.opt.on strong { color: var(--fg); font-weight: 650; }
.opt em { font-style: normal; font-size: 11px; line-height: 1.4; color: var(--fg-faint); }
.opt.risky strong { color: var(--warn); }
</style>
