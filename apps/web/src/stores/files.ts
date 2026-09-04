import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { DirEntry } from '@remotedevplus/protocol';
import { api, q } from '../api';
import { useWorkspaces } from './workspaces';

export interface TreeRow {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export const useFiles = defineStore('files', () => {
  const workspaces = useWorkspaces();
  const children = ref(new Map<string, DirEntry[]>());
  const expanded = ref(new Set<string>());
  const loading = ref(new Set<string>());
  const error = ref('');

  /**
   * El explorador muestra las carpetas del workspace activo, no las raíces
   * crudas del agente. Las raíces siguen siendo el límite de seguridad; el
   * workspace es la vista, y por eso acá solo se lee.
   */
  const folders = computed(() => workspaces.active?.folders ?? []);

  /** Con una sola carpeta se abre sola: es el caso normal de un proyecto. */
  async function openInitial() {
    reset();
    if (folders.value.length === 1) await expand(folders.value[0].path);
  }

  function reset() {
    children.value = new Map();
    expanded.value = new Set();
    error.value = '';
  }

  async function load(path: string, force = false) {
    if (children.value.has(path) && !force) return;
    loading.value = new Set(loading.value).add(path);
    try {
      const r = await api.get<{ entries: DirEntry[] }>(`/api/fs/list?path=${q(path)}`);
      children.value = new Map(children.value).set(path, r.entries);
    } catch (e: any) {
      error.value = e?.message || `No se pudo leer ${path}`;
      children.value = new Map(children.value).set(path, []);
    } finally {
      const next = new Set(loading.value);
      next.delete(path);
      loading.value = next;
    }
  }

  async function expand(path: string) {
    expanded.value = new Set(expanded.value).add(path);
    await load(path);
  }

  function collapse(path: string) {
    const next = new Set(expanded.value);
    next.delete(path);
    expanded.value = next;
  }

  function toggle(path: string) {
    return expanded.value.has(path) ? collapse(path) : expand(path);
  }

  function refresh(path: string) {
    return load(path, true);
  }

  /**
   * El árbol se entrega aplanado, no anidado.
   *
   * Así el render es una lista y la virtualización (pintar solo las filas
   * visibles) es un cambio local cuando el árbol crezca, en vez de un rediseño.
   */
  const rows = computed<TreeRow[]>(() => {
    const out: TreeRow[] = [];
    const walk = (path: string, depth: number) => {
      for (const entry of children.value.get(path) ?? []) {
        const isOpen = expanded.value.has(entry.path);
        out.push({
          entry,
          depth,
          expanded: isOpen,
          loading: loading.value.has(entry.path),
        });
        if (entry.kind === 'dir' && isOpen) walk(entry.path, depth + 1);
      }
    };
    for (const folder of folders.value) {
      const isOpen = expanded.value.has(folder.path);
      out.push({
        entry: { name: folder.name, path: folder.path, kind: 'dir', size: null, mtime: null },
        depth: 0,
        expanded: isOpen,
        loading: loading.value.has(folder.path),
      });
      if (isOpen) walk(folder.path, 1);
    }
    return out;
  });

  /** Directorio con el que arrancan las terminales nuevas. */
  const defaultCwd = computed(() => folders.value[0]?.path ?? '.');

  return {
    folders, children, expanded, loading, error, rows, defaultCwd,
    openInitial, reset, load, expand, collapse, toggle, refresh,
  };
});
