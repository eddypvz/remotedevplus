import { defineStore } from 'pinia';
import { ref, computed, watch as observar } from 'vue';
import type { DirEntry } from '@remotedevplus/protocol';
import { api, q } from '../api';
import { useWorkspaces } from './workspaces';
import { useEventos } from './eventos';

export interface TreeRow {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export const useFiles = defineStore('files', () => {
  const workspaces = useWorkspaces();
  const eventos = useEventos();
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

  /*
   * El árbol se mantiene solo.
   *
   * Se observan exactamente las carpetas desplegadas, que son las que están a
   * la vista. Desplegar suscribe y plegar da de baja, así que un proyecto con
   * tres carpetas abiertas cuesta tres inotify y no el árbol entero — que en un
   * `node_modules` sería inviable.
   *
   * Antes de esto había que refrescar a mano, y el caso más común era el peor:
   * Claude Code escribiendo archivos que el explorador no mostraba.
   */
  observar(expanded, (abiertas) => {
    eventos.sincronizarGrupo('explorer', [...abiertas]);
  });

  eventos.onFsChanged((path) => {
    // Solo se relee lo que se está mostrando. Un aviso de una carpeta que ya se
    // plegó llega tarde y no interesa.
    if (expanded.value.has(path)) load(path, true);
  });

  /*
   * OPERACIONES SOBRE ARCHIVOS
   *
   * Todas terminan releyendo el directorio afectado. El canal de eventos lo
   * haría igual, pero con 150ms de retardo: al tocar "Renombrar" el nombre
   * nuevo tiene que estar ahí antes de que el dedo se levante.
   */

  const dirDe = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

  /** Relee un directorio si está a la vista; si no, olvida lo que sabía de él. */
  async function tocado(dir: string) {
    if (expanded.value.has(dir)) await load(dir, true);
    else children.value.delete(dir);
  }

  async function crearArchivo(dir: string, name: string) {
    const r = await api.post<{ path: string }>('/api/fs/create', { dir, name });
    await expand(dir);
    await tocado(dir);
    return r.path;
  }

  async function crearCarpeta(dir: string, name: string) {
    const r = await api.post<{ path: string }>('/api/fs/mkdir', { dir, name });
    await expand(dir);
    await tocado(dir);
    return r.path;
  }

  async function renombrar(path: string, nombre: string) {
    const dir = dirDe(path);
    const r = await api.post<{ to: string }>('/api/fs/rename', { from: path, to: `${dir}/${nombre}` });
    await tocado(dir);
    return r.to;
  }

  async function eliminar(path: string, recursive: boolean) {
    await api.post('/api/fs/remove', { path, recursive });
    collapse(path);
    children.value.delete(path);
    await tocado(dirDe(path));
  }

  /**
   * Portapapeles de archivos, interno a la aplicación.
   *
   * No usa el del sistema a propósito: el del navegador no maneja archivos del
   * servidor, y fuera de HTTPS ni siquiera existe. Copiar acá guarda rutas, y
   * pegar le pide al agente que copie o mueva — el archivo nunca pasa por el
   * navegador, que además es lo único que funciona con una carpeta de 2GB.
   */
  const portapapeles = ref<{ modo: 'copiar' | 'cortar'; paths: string[] } | null>(null);

  function copiarAlPortapapeles(paths: string[], modo: 'copiar' | 'cortar') {
    portapapeles.value = paths.length ? { modo, paths } : null;
  }

  async function pegarEn(dir: string) {
    const pp = portapapeles.value;
    if (!pp) return [];
    const ruta = pp.modo === 'cortar' ? '/api/fs/move' : '/api/fs/copy';
    const origen = new Set(pp.paths.map(dirDe));
    const hechos: string[] = [];
    for (const from of pp.paths) {
      const r = await api.post<{ path: string }>(ruta, { from, toDir: dir });
      hechos.push(r.path);
    }
    // Cortar vacía el portapapeles: pegarlo dos veces movería lo que ya no está.
    if (pp.modo === 'cortar') {
      portapapeles.value = null;
      for (const d of origen) await tocado(d);
    }
    await expand(dir);
    await tocado(dir);
    return hechos;
  }

  /**
   * Sube archivos al directorio indicado.
   *
   * Uno por petición y en serie: así el progreso es real —"3 de 12"— y un
   * archivo que falla no arrastra a los demás. El cuerpo son los bytes crudos,
   * sin multipart ni base64.
   */
  async function subir(dir: string, archivos: File[], avance?: (hechos: number, total: number) => void) {
    const subidos: string[] = [];
    const fallos: { nombre: string; motivo: string }[] = [];
    for (const [i, f] of archivos.entries()) {
      avance?.(i, archivos.length);
      try {
        const res = await fetch(
          `/api/fs/upload?dir=${q(dir)}&name=${q(f.name)}`,
          { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message || res.statusText);
        subidos.push(data.path);
      } catch (e: any) {
        fallos.push({ nombre: f.name, motivo: e?.message || 'error desconocido' });
      }
    }
    avance?.(archivos.length, archivos.length);
    await expand(dir);
    await tocado(dir);
    return { subidos, fallos };
  }

  return {
    folders, children, expanded, loading, error, rows, defaultCwd, portapapeles,
    openInitial, reset, load, expand, collapse, toggle, refresh,
    dirDe, crearArchivo, crearCarpeta, renombrar, eliminar,
    copiarAlPortapapeles, pegarEn, subir,
  };
});
