<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import { useLauncher } from '../../stores/launcher';
import { useWorkspaces } from '../../stores/workspaces';
import type { WorkspaceFolder } from '../../stores/workspaces';

const launcher = useLauncher();
const workspaces = useWorkspaces();

const esClaude = computed(() => (
  launcher.asking === 'claude-native' || launcher.asking === 'claude'
));

/**
 * Los dos clientes de Claude conviven a propósito. El nativo tiene historial,
 * permisos como diálogo y una caja de texto de verdad; el terminal es la TUI
 * tal cual, y sigue ahí para cuando haga falta algo que el nativo no cubra.
 */
const motores = [
  { id: 'claude-native', label: 'Nativo', hint: 'Con historial, permisos como diálogo y caja de texto multilínea' },
  { id: 'claude', label: 'Terminal', hint: 'La interfaz original de Claude Code, tal cual' },
];
const motor = ref('claude-native');

const title = computed(() => {
  if (esClaude.value) return 'Abrir Claude Code';
  if (launcher.asking === 'terminal') return 'Abrir una terminal';
  return 'Seleccionar carpeta';
});

function elegir(f: WorkspaceFolder) {
  launcher.pick(f, esClaude.value ? { engine: motor.value } : {});
}
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click.self="launcher.cancel()">
      <div class="sheet" role="dialog" aria-modal="true" :aria-label="title">
        <header>
          <Icon :name="launcher.askingModule?.icon ?? 'folder'" :size="17" />
          <h2>{{ title }}</h2>
          <button class="x" aria-label="Cancelar" @click="launcher.cancel()">
            <Icon name="close" :size="16" />
          </button>
        </header>

        <div v-if="esClaude" class="motores" role="radiogroup" aria-label="Cliente">
          <button
            v-for="m in motores" :key="m.id"
            class="motor" :class="{ on: motor === m.id }"
            role="radio" :aria-checked="motor === m.id"
            @click="motor = m.id"
          >
            <strong>{{ m.label }}</strong>
            <em>{{ m.hint }}</em>
          </button>
        </div>

        <p class="lead">
          <template v-if="launcher.folders.length > 1">
            El workspace <strong>{{ workspaces.active?.name }}</strong> tiene
            {{ launcher.folders.length }} carpetas. La elegida será el directorio
            de trabajo.
          </template>
          <template v-else>Se abrirá en la única carpeta del workspace.</template>
        </p>

        <ul>
          <li v-for="f in launcher.folders" :key="f.path">
            <button @click="elegir(f)">
              <Icon name="folder" :size="17" />
              <span class="nm">{{ f.name }}</span>
              <span class="p">{{ f.path }}</span>
              <Icon name="chevron" :size="15" class="go" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 60;
  display: grid; place-items: center; padding: 1.25rem;
  padding-top: calc(1.25rem + var(--safe-t)); padding-bottom: calc(1.25rem + var(--safe-b));
  /* Sin backdrop-filter: rompe el hit-testing sobre el canvas WebGL del
     terminal en WebKit. Ver WorkspaceModal. */
  background: var(--scrim);
}
.sheet {
  display: flex; flex-direction: column; gap: 13px;
  width: 100%; max-width: 32rem; max-height: 100%;
  padding: 16px; overflow: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: 0 24px 60px var(--shadow);
}

header { display: flex; align-items: center; gap: 9px; }
header :deep(svg) { flex: 0 0 auto; color: var(--accent); }
header h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
.x { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--fg-faint); }
.x:hover { background: var(--bg-hover); color: var(--fg); }

.motores { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 7px; }
.motor {
  display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
  padding: 9px 11px; text-align: left;
  background: var(--bg); border: 1px solid var(--border); border-radius: 9px;
}
.motor strong { font-size: 13px; font-weight: 600; color: var(--fg); }
.motor em { font-style: normal; font-size: 11px; line-height: 1.45; color: var(--fg-faint); }
.motor:hover { border-color: var(--border-strong); }
.motor.on { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 7%, var(--bg)); }

.lead { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--fg-faint); }
.lead strong { color: var(--fg-dim); }

ul { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
li button {
  display: flex; align-items: center; gap: 9px; width: 100%;
  min-height: var(--touch); padding: 8px 10px; text-align: left;
  background: var(--bg); border: 1px solid var(--border); border-radius: 9px;
}
li button:hover { border-color: var(--accent); background: var(--bg-hover); }
li :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.nm { flex: 0 0 auto; font-size: 13.5px; font-weight: 550; color: var(--fg); }
.p {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left; font: 11px var(--mono); color: var(--fg-faint);
}
.go { color: var(--fg-faint) !important; }
</style>
