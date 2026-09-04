<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import Icon from '../../ui/Icon.vue';
import { useCompose } from '../../stores/compose';
import { useSettings } from '../../stores/settings';

/**
 * Caja de texto para hablarle a Claude.
 *
 * Se escribió para el terminal y ahí no alcanzaba: el prompt de una TUI es un
 * editor de línea. Es la entrada del cliente nativo, donde sí tiene sentido —
 * el borrador vive por pestaña, así que cambiar de pestaña no lo pierde.
 *
 * Los controles de la conversación van en la barra de abajo, por el slot
 * `tools`: quedan al alcance del pulgar y junto a lo que uno está escribiendo,
 * en vez de arriba lejos del foco.
 */
const props = defineProps<{
  tabKey: string;
  cwd: string;
  disabled?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{ (e: 'send', text: string): void }>();

const compose = useCompose();
const settings = useSettings();
const box = ref<HTMLTextAreaElement>();

const draft = computed(() => compose.get(props.tabKey));
const empty = computed(() => !draft.value.text.trim() && !draft.value.attachments.length);

/** Las rutas se muestran relativas al directorio de la sesión: es más legible. */
function short(path: string) {
  if (path === props.cwd) return '.';
  return path.startsWith(props.cwd + '/') ? path.slice(props.cwd.length + 1) : path;
}

function grow() {
  const el = box.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px';
}

watch(() => draft.value.text, () => nextTick(grow));

function send() {
  if (empty.value || props.disabled) return;
  // Los adjuntos van como referencias @ruta al principio: es lo que entiende
  // Claude Code para incorporar un archivo al contexto.
  const refs = draft.value.attachments.map((p) => '@' + short(p)).join(' ');
  const body = draft.value.text.trim();
  emit('send', refs ? (body ? `${refs}\n\n${body}` : refs) : body);
  compose.clear(props.tabKey);
  nextTick(grow);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return;
  // Con "Enter envía", Shift+Enter inserta el salto; con la preferencia al
  // revés, es Ctrl/Cmd+Enter el que manda.
  const submit = settings.enterSends
    ? !e.shiftKey && !e.isComposing
    : (e.metaKey || e.ctrlKey);
  if (submit) {
    e.preventDefault();
    send();
  }
}

defineExpose({ focus: () => nextTick(() => box.value?.focus()) });
</script>

<template>
  <div class="composer">
    <div v-if="draft.attachments.length" class="chips">
      <span v-for="p in draft.attachments" :key="p" class="chip" :title="p">
        <Icon name="file" :size="12" />
        {{ short(p) }}
        <button aria-label="Quitar" @click="compose.detach(props.tabKey, p)">
          <Icon name="close" :size="11" />
        </button>
      </span>
    </div>

    <textarea
      ref="box"
      :value="draft.text"
      class="box" rows="2"
      spellcheck="false" autocapitalize="sentences" autocorrect="off"
      :placeholder="props.placeholder ?? 'Escriba aquí…'"
      @input="compose.setText(props.tabKey, ($event.target as HTMLTextAreaElement).value)"
      @keydown="onKeydown"
    />

    <div class="tools">
      <slot name="tools" />
      <button
        class="send" :disabled="empty || props.disabled"
        :title="settings.enterSends ? 'Enter' : 'Ctrl+Enter'"
        @click="send"
      >
        <Icon name="chevron" :size="17" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  display: flex; flex-direction: column; gap: 7px; flex: 0 0 auto;
  padding: 8px 10px calc(8px + var(--safe-b));
  background: var(--bg-panel); border-top: 1px solid var(--border);
}

.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 4px 2px 7px; border-radius: 20px;
  background: var(--bg-surface); border: 1px solid var(--border);
  font: 11px var(--mono); color: var(--fg-dim);
}
.chip :deep(svg) { color: var(--accent); }
.chip button {
  display: grid; place-items: center; width: 17px; height: 17px;
  border-radius: 50%; color: var(--fg-faint);
}
.chip button:hover { background: var(--bg-active); color: var(--danger); }

.box {
  width: 100%; min-height: 46px; max-height: 40dvh;
  padding: 10px 12px; resize: none;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 10px;
  /* 16px o iOS hace zoom al enfocar el campo; con puntero fino se respeta el
     tamaño elegido en los ajustes. */
  font: 16px/1.5 var(--mono);
  overflow-y: auto;
}
.box:focus { outline: none; border-color: var(--accent); }
@media (pointer: fine) { .box { font-size: inherit; } }

/*
 * Barra de controles debajo del campo, como en el plugin de VS Code.
 *
 * Sin `overflow` y con wrap a propósito: un ancestro con overflow recorta a sus
 * descendientes posicionados en absoluto, y los menús de los controles viven
 * justamente ahí. Con scroll horizontal se veía solo una franja del menú.
 */
.tools {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  min-width: 0;
}

.send {
  display: grid; place-items: center; flex: 0 0 auto;
  width: 36px; height: 32px; margin-left: auto;
  border-radius: 9px;
  background: var(--accent); color: var(--on-accent);
}
.send :deep(svg) { transform: rotate(-90deg); }
.send:disabled { background: var(--bg-active); color: var(--fg-faint); cursor: default; }
</style>
