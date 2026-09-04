<script setup lang="ts">
import { ref, watch } from 'vue';
import type { DirEntry, RootRef } from '@remotedevplus/protocol';
import { api, q } from '../../api';
import Icon from '../../ui/Icon.vue';

/**
 * Navegador de solo-directorios para elegir carpetas de un workspace.
 *
 * Arranca en las raíces del agente y no deja salir de ahí — no porque el
 * componente lo impida, sino porque el agente rechaza cualquier ruta fuera y
 * la lista viene de él.
 */
const props = defineProps<{ roots: RootRef[]; chosen: string[] }>();
const emit = defineEmits<{ (e: 'pick', path: string, name: string): void }>();

const cwd = ref<string | null>(null);
const entries = ref<DirEntry[]>([]);
const loading = ref(false);
const error = ref('');

/** Migas de pan hasta la raíz que contiene el directorio actual. */
const crumbs = ref<{ label: string; path: string }[]>([]);

function buildCrumbs(path: string) {
  const root = props.roots.find((r) => path === r.path || path.startsWith(r.path + '/'));
  if (!root) return [{ label: path, path }];
  const rest = path.slice(root.path.length).split('/').filter(Boolean);
  const out = [{ label: root.name, path: root.path }];
  let acc = root.path;
  for (const part of rest) {
    acc += '/' + part;
    out.push({ label: part, path: acc });
  }
  return out;
}

async function go(path: string) {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.get<{ entries: DirEntry[] }>(`/api/fs/list?path=${q(path)}`);
    entries.value = r.entries.filter((e) => e.kind === 'dir');
    cwd.value = path;
    crumbs.value = buildCrumbs(path);
  } catch (e: any) {
    error.value = e?.message || 'No se pudo abrir la carpeta';
  } finally {
    loading.value = false;
  }
}

function toRoots() {
  cwd.value = null;
  entries.value = [];
  crumbs.value = [];
}

watch(() => props.roots, (r) => { if (r.length === 1 && !cwd.value) go(r[0].path); }, { immediate: true });
</script>

<template>
  <div class="browser">
    <nav class="crumbs">
      <button class="crumb" :class="{ on: !cwd }" @click="toRoots">raíces</button>
      <template v-for="c in crumbs" :key="c.path">
        <span class="sep">/</span>
        <button class="crumb" :class="{ on: c.path === cwd }" @click="go(c.path)">{{ c.label }}</button>
      </template>
    </nav>

    <div class="list rdp-scroll">
      <p v-if="error" class="err">{{ error }}</p>

      <template v-if="!cwd">
        <button v-for="r in roots" :key="r.path" class="item" @click="go(r.path)">
          <Icon name="folder" :size="16" />
          <span class="nm">{{ r.name }}</span>
          <span class="hint">{{ r.path }}</span>
        </button>
      </template>

      <template v-else>
        <div class="item current">
          <Icon name="folder" :size="16" />
          <span class="nm">esta carpeta</span>
          <button
            class="add" :disabled="chosen.includes(cwd)"
            @click="emit('pick', cwd, crumbs[crumbs.length - 1]?.label ?? cwd)"
          >{{ chosen.includes(cwd) ? 'ya está' : 'agregar' }}</button>
        </div>

        <button v-for="e in entries" :key="e.path" class="item" @click="go(e.path)">
          <Icon name="folder" :size="16" />
          <span class="nm">{{ e.name }}</span>
          <span
            class="add ghost" :class="{ off: chosen.includes(e.path) }"
            @click.stop="!chosen.includes(e.path) && emit('pick', e.path, e.name)"
          >{{ chosen.includes(e.path) ? 'ya está' : 'agregar' }}</span>
        </button>

        <p v-if="!entries.length && !loading" class="empty">No hay subcarpetas.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.browser {
  display: flex; flex-direction: column; min-height: 0;
  border: 1px solid var(--border); border-radius: 9px; background: var(--bg);
  overflow: hidden;
}

.crumbs {
  display: flex; align-items: center; gap: 2px; flex: 0 0 auto;
  padding: 6px 8px; overflow-x: auto; white-space: nowrap;
  background: var(--bg-surface); border-bottom: 1px solid var(--border);
  scrollbar-width: none;
}
.crumbs::-webkit-scrollbar { height: 0; }
.crumb { padding: 2px 6px; border-radius: 5px; font-size: 12px; color: var(--fg-dim); }
.crumb:hover { background: var(--bg-hover); color: var(--fg); }
.crumb.on { color: var(--fg); font-weight: 600; }
.sep { color: var(--fg-faint); font-size: 12px; }

.list { flex: 1; min-height: 0; padding: 4px; }

.item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  min-height: 38px; padding: 0 8px; border-radius: 7px;
  color: var(--fg-dim); text-align: left;
}
.item:hover { background: var(--bg-hover); color: var(--fg); }
.item :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.item.current { color: var(--fg); font-weight: 550; }
.nm { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.hint {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 11px var(--mono); color: var(--fg-faint); text-align: right;
}

.add {
  margin-left: auto; flex: 0 0 auto;
  padding: 3px 9px; border-radius: 6px;
  background: var(--accent); color: var(--on-accent); font-size: 11.5px;
}
.add:disabled, .add.off { background: var(--bg-active); color: var(--fg-faint); cursor: default; }
.add.ghost { opacity: 0; }
.item:hover .add.ghost { opacity: 1; }
@media (pointer: coarse) { .add.ghost { opacity: 1; } }

.err { margin: 8px; font-size: 12px; color: var(--danger); }
.empty { margin: 8px; font-size: 12px; color: var(--fg-faint); }
</style>
