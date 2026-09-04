<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { PtyKind } from '@remotedevplus/protocol';
import { usePtySocket } from './usePtySocket';
import { terminalTheme } from './theme';
import { useTerminals } from '../../stores/terminals';
import { useFiles } from '../../stores/files';
import { useSettings } from '../../stores/settings';
import AccessoryKeys from './AccessoryKeys.vue';
import Icon from '../../ui/Icon.vue';

/**
 * Un terminal, y nada más.
 *
 * Se probó rodearlo de controles —compositor multilínea, selector de modelo,
 * cabecera de sesión— para que Claude Code se pareciera al plugin de VS Code.
 * No alcanza: la TUI dibuja sobre un buffer de pantalla y no entrega los
 * mensajes, así que el historial es irrecuperable desde afuera. Eso se resuelve
 * en el módulo `claude-native`, que usa el Agent SDK. Acá se volvió a un
 * terminal clásico a propósito.
 */
const props = defineProps<{
  kind: PtyKind;
  ctx: Record<string, unknown>;
  active: boolean;
}>();

const terminals = useTerminals();
const files = useFiles();
const settings = useSettings();

const host = ref<HTMLDivElement>();
const keysRef = ref<InstanceType<typeof AccessoryKeys>>();
const term = shallowRef<Terminal>();
const fit = shallowRef<FitAddon>();
const webgl = shallowRef<{ dispose(): void; clearTextureAtlas?(): void } | null>(null);
const ctrlPending = ref(false);
const sessionId = ref<string | null>((props.ctx.sessionId as string) ?? null);
const failure = ref('');

const socket = usePtySocket({
  onData: (bytes) => term.value?.write(bytes),
  onReset: () => term.value?.reset(),
  onExit: () => {},
});

const statusLabel = computed(() => ({
  conectando: 'conectando…',
  conectado: '',
  reconectando: 'reconectando…',
  terminado: socket.message.value,
  error: socket.message.value,
}[socket.status.value]));

function doFit() {
  if (!term.value || !fit.value || !host.value?.offsetParent) return;
  try {
    fit.value.fit();
    socket.resize(term.value.cols, term.value.rows);
  } catch { /* el contenedor puede tener 0px durante una transición */ }
}

function sendKeys(data: string) {
  socket.send(data);
  term.value?.focus();
}


onMounted(async () => {
  const t = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: settings.fontSize,
    lineHeight: 1.25,
    cursorBlink: true,
    // El scrollback del cliente es solo para mirar hacia atrás; la verdad del
    // stream la tiene el ring buffer del agente.
    scrollback: 5000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: terminalTheme(settings.resolvedTheme),
  });

  const fitAddon = new FitAddon();
  t.loadAddon(fitAddon);
  const uni = new Unicode11Addon();
  t.loadAddon(uni);
  t.unicode.activeVersion = '11';

  t.open(host.value!);

  // WebGL da fluidez con salida abundante, pero no está en todos los
  // dispositivos: si falla se sigue con el renderer por defecto.
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl');
    const addon = new WebglAddon();
    addon.onContextLoss(() => addon.dispose());
    t.loadAddon(addon);
    webgl.value = addon;
  } catch { /* renderer DOM */ }

  /**
   * Ctrl pegajoso: la tecla del rail marca el modificador y la SIGUIENTE tecla
   * del teclado real se convierte en carácter de control. Es la única forma de
   * hacer Ctrl+C en un iPad, cuyo teclado en pantalla no tiene Ctrl.
   */
  t.attachCustomKeyEventHandler((e) => {
    if (!ctrlPending.value || e.type !== 'keydown') return true;
    if (e.key.length === 1) {
      const code = e.key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        socket.send(String.fromCharCode(code - 64));
        ctrlPending.value = false;
        keysRef.value?.clearCtrl();
        return false;
      }
    }
    return true;
  });

  t.onData((data) => socket.send(data));
  term.value = t;
  fit.value = fitAddon;

  // ResizeObserver y no un listener de window: la pestaña cambia de tamaño al
  // abrirse o cerrarse el sidebar, sin que la ventana se mueva.
  const ro = new ResizeObserver(() => doFit());
  ro.observe(host.value!);
  observer = ro;

  document.addEventListener('visibilitychange', onVisible);

  await nextTick();
  doFit();

  try {
    const cwd = (props.ctx.cwd as string) || files.defaultCwd;
    const s = await terminals.adopt(props.kind, cwd, sessionId.value ?? undefined);
    sessionId.value = s.id;
    // Se anota en el contexto de la pestaña para que al recargar la página se
    // reenganche esta misma sesión.
    props.ctx.sessionId = s.id;
    socket.connect(s.id);
    doFit();
  } catch (e: any) {
    failure.value = e?.message || 'No se pudo abrir la terminal';
  }
});

let observer: ResizeObserver | undefined;

function onVisible() {
  if (document.visibilityState === 'visible') {
    socket.wake();
    nextTick(doFit);
  }
}

// xterm pinta en canvas: no hereda las variables CSS, hay que darle la paleta
// nueva a mano. Y el atlas de texturas de WebGL cachea los glifos ya pintados
// con los colores viejos, así que sin limpiarlo queda texto del tema anterior.
watch(() => settings.resolvedTheme, (resolved) => {
  if (!term.value) return;
  term.value.options.theme = terminalTheme(resolved);
  webgl.value?.clearTextureAtlas?.();
});

watch(() => settings.fontSize, (size) => {
  if (!term.value) return;
  term.value.options.fontSize = size;
  nextTick(doFit);
});

// Al mostrar u ocultar la barra de teclas cambia el alto disponible.
watch(() => settings.accessoryKeys, () => nextTick(doFit));

// Al volver a la pestaña hay que reajustar: mientras estaba oculta con
// display:none el contenedor medía 0 y xterm no podía calcular filas.
watch(() => props.active, (isActive) => {
  if (!isActive) return;
  nextTick(() => { doFit(); term.value?.focus(); });
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible);
  observer?.disconnect();
  socket.dispose();
  term.value?.dispose();
});
</script>

<template>
  <div class="pty">
    <div v-if="statusLabel || failure" class="bar" :class="socket.status.value">
      <Icon :name="socket.status.value === 'error' || failure ? 'alert' : 'refresh'" :size="14" />
      <span>{{ failure || statusLabel }}</span>
    </div>

    <div ref="host" class="screen" />

    <div class="tools">
      <button class="tool" title="Letra más chica" @click="settings.setFontSize(settings.fontSize - 1)">A−</button>
      <button class="tool" title="Letra más grande" @click="settings.setFontSize(settings.fontSize + 1)">A+</button>
      <button
        class="tool" :class="{ on: settings.accessoryKeys }"
        title="Barra de teclas" @click="settings.toggleAccessoryKeys()"
      >
        <Icon name="keyboard" :size="15" />
      </button>
    </div>

    <AccessoryKeys
      v-if="settings.accessoryKeys"
      ref="keysRef"
      @send="sendKeys"
      @ctrl="(on) => { ctrlPending = on; term?.focus(); }"
    />
  </div>
</template>

<style scoped>
.pty { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }

.screen {
  flex: 1; min-height: 0;
  padding: 6px 0 4px 8px;
  /* El terminal maneja su propio scroll; el pinch del navegador está apagado
     en el viewport, y el tamaño se cambia con A− / A+. */
  touch-action: pan-y;
}
.screen :deep(.xterm) { height: 100%; }
.screen :deep(.xterm-viewport) { background: transparent !important; }

.bar {
  display: flex; align-items: center; gap: 7px;
  flex: 0 0 auto; padding: 5px 10px;
  font-size: 12px; color: var(--fg-dim);
  background: var(--bg-surface); border-bottom: 1px solid var(--border);
}
.bar.error, .bar.terminado { color: var(--warn); }

.tools {
  position: absolute; top: 6px; right: 12px; z-index: 2;
  display: flex; gap: 4px; opacity: .25; transition: opacity .15s;
}
.pty:hover .tools, .tools:focus-within { opacity: 1; }
@media (pointer: coarse) { .tools { opacity: .8; } }

.tool {
  display: grid; place-items: center;
  min-width: 28px; height: 26px; padding: 0 6px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 6px; color: var(--fg-dim); font-size: 11px; font-family: var(--mono);
}
.tool:hover, .tool.on { color: var(--fg); background: var(--bg-active); }
</style>
