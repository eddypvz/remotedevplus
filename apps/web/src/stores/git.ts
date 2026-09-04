import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, q } from '../api';

export interface GitArchivo {
  ruta: string;
  origen: string | null;
  staged: string | null;
  arbol: string | null;
  conflicto: boolean;
  sinRastrear?: boolean;
}

export interface GitEstado {
  rama: string | null;
  /** Operación a medias parada en un conflicto, o null. */
  operacion: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
  /** Sin rama: parado directamente en un commit. */
  desprendido: boolean;
  oidCorto: string;
  upstream: string | null;
  adelante: number;
  atras: number;
  preparados: GitArchivo[];
  cambiados: GitArchivo[];
  sinRastrear: GitArchivo[];
  conflictos: GitArchivo[];
}

export interface GitCommit {
  hash: string; corto: string; autor: string; correo: string;
  fecha: number; asunto: string; parents: string[]; refs: string[];
  carril: number; entraArriba: boolean; entrantes: number[];
  cruzando: number[]; salidas: { carril: number; hash: string }[]; ancho: number;
}

export interface GitRama {
  nombre: string; ref: string; upstream: string | null;
  adelante: number; atras: number; oid: string; fecha: number;
  actual: boolean; tipo: 'local' | 'remota' | 'etiqueta';
}

export interface GitStash {
  ref: string; hash: string; fecha: number;
  mensaje: string; rama: string | null; archivos: string[];
}

/**
 * Estado de git para una carpeta.
 *
 * El store es por carpeta y no global: un workspace puede tener dos repos, y
 * mezclarlos daría un árbol sin sentido.
 */
export const useGit = defineStore('git', () => {
  const cwd = ref<string | null>(null);
  const estado = ref<GitEstado | null>(null);
  const commits = ref<GitCommit[]>([]);
  const ramas = ref<GitRama[]>([]);
  const stashes = ref<GitStash[]>([]);
  const cargando = ref(false);
  const error = ref('');

  const hayTrabajo = computed(() => {
    const e = estado.value;
    if (!e) return false;
    return e.preparados.length + e.cambiados.length + e.sinRastrear.length + e.conflictos.length > 0;
  });

  const anchoMaximo = computed(() => Math.max(1, ...commits.value.map((c) => Math.max(c.ancho, c.carril + 1))));

  async function cargar(carpeta: string, completo = true) {
    cwd.value = carpeta;
    cargando.value = true;
    error.value = '';
    try {
      const p = `cwd=${q(carpeta)}`;
      const [e, g, b, s] = await Promise.all([
        api.get<GitEstado>(`/api/git/status?${p}`),
        completo ? api.get<{ commits: GitCommit[] }>(`/api/git/graph?${p}&limit=300`) : Promise.resolve(null),
        completo ? api.get<{ ramas: GitRama[] }>(`/api/git/branches?${p}`) : Promise.resolve(null),
        api.get<{ entradas: GitStash[] }>(`/api/git/stash?${p}`),
      ]);
      estado.value = e;
      if (g) commits.value = g.commits;
      if (b) ramas.value = b.ramas;
      stashes.value = s.entradas;
    } catch (err: any) {
      error.value = err?.message || 'No se pudo leer el repositorio';
      estado.value = null;
    } finally {
      cargando.value = false;
    }
  }

  /** Las acciones devuelven el estado nuevo, así que se aplica sin volver a pedirlo. */
  async function accion<T extends { estado?: GitEstado } | GitEstado>(
    ruta: string, cuerpo: Record<string, unknown> = {},
  ) {
    const r = await api.post<any>(ruta, { cwd: cwd.value, ...cuerpo });
    estado.value = (r?.estado ?? r) as GitEstado;
    return r;
  }

  return {
    cwd, estado, commits, ramas, stashes, cargando, error, hayTrabajo, anchoMaximo,
    cargar,
    preparar: (paths: string[]) => accion('/api/git/stage', { paths }),
    quitar: (paths: string[]) => accion('/api/git/unstage', { paths }),
    descartar: (paths: string[]) => accion('/api/git/discard', { paths }),
    commit: (message: string, amend = false) => accion('/api/git/commit', { message, amend }),
    guardarStash: (message: string) => accion('/api/git/stash', { message }),
    aplicarStash: (ref: string, pop: boolean) => accion('/api/git/stash/apply', { ref, pop }),
    borrarStash: async (ref: string) => {
      const r = await api.del<{ entradas: GitStash[] }>('/api/git/stash', { cwd: cwd.value, ref });
      stashes.value = r.entradas;
    },
    cambiarRama: (name: string, create = false) => accion('/api/git/switch', { name, create }),
    traer: () => accion('/api/git/fetch'),
    bajar: (rebase = false) => accion('/api/git/pull', { rebase }),
    subir: (force = false) => accion('/api/git/push', { force }),
    reordenar: (onto: string) => accion('/api/git/rebase', { onto }),
    situarse: (ref: string) => accion('/api/git/checkout', { ref }),
    /** `side`: 'ours' o 'theirs' se quedan con un lado; 'manual' solo marca resuelto. */
    resolver: (paths: string[], side: 'ours' | 'theirs' | 'manual') =>
      accion('/api/git/resolve', { paths, side }),
    seguir: (action: 'continuar' | 'abortar') => accion('/api/git/sequencer', { action }),
    diff: (path: string, staged: boolean) =>
      api.get<{ diff: string }>(`/api/git/diff?cwd=${q(cwd.value!)}&path=${q(path)}&staged=${staged ? 1 : 0}`),
  };
});
