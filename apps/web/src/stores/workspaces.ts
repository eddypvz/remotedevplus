import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RootRef } from '@remotedevplus/protocol';
import { api } from '../api';
import { workspaceAlArrancar, tomadoPorOtra, latir } from './pestanaNavegador';

export interface WorkspaceFolder { name: string; path: string; host: string }

export interface Workspace {
  id: number;
  name: string;
  folders: WorkspaceFolder[];
  /** Carpetas guardadas que hoy caen fuera de las raíces permitidas. */
  unavailable: number;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
}

/** Lo último elegido en cualquier pestaña, para que reabrir caiga donde estabas. */
const ULTIMO = 'rdp.workspace';
/** El de ESTA pestaña del navegador. */
const PROPIO = 'rdp.workspace.pestana';

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); }
  catch { /* modo privado */ }
}
function readSesion(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeSesion(key: string, value: string | null) {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); }
  catch { /* modo privado */ }
}

export const useWorkspaces = defineStore('workspaces', () => {
  const list = ref<Workspace[]>([]);
  /** Las raíces del agente: el límite duro de dónde puede elegir carpetas. */
  const roots = ref<RootRef[]>([]);
  /*
   * El workspace activo es **de esta pestaña del navegador**.
   *
   * Antes vivía solo en `localStorage`, que se comparte entre pestañas del mismo
   * navegador: elegir proyecto en una lo cambiaba en la otra, así que trabajar
   * en dos a la vez era imposible. Ahora manda `sessionStorage`, que sí es por
   * pestaña, y `localStorage` guarda el último elegido para que reabrir el
   * navegador caiga donde estabas — pero solo si ninguna otra pestaña lo tiene
   * abierto. Ver `stores/pestanaNavegador.ts`.
   */
  const activeId = ref<number | null>(workspaceAlArrancar(
    Number(readSesion(PROPIO)) || null,
    Number(read(ULTIMO)) || null,
  ));
  const loaded = ref(false);
  const error = ref('');
  /** El selector se abre desde el explorador, desde ajustes y solo al arrancar
   *  sin workspace activo. */
  const pickerOpen = ref(false);

  const active = computed(() => list.value.find((w) => w.id === activeId.value) ?? null);

  /**
   * La selección vive en localStorage, no en la base, a propósito: permite
   * tener el backend abierto en la laptop y otro proyecto en la tablet al mismo
   * tiempo. Lo que sí es compartido son las definiciones.
   */
  function select(id: number | null) {
    activeId.value = id;
    writeSesion(PROPIO, id === null ? null : String(id));
    write(ULTIMO, id === null ? null : String(id));
    latir(id);
    if (id !== null) api.post(`/api/workspaces/${id}/open`).catch(() => {});
  }

  /** Si otra pestaña del navegador tiene este workspace abierto ahora mismo. */
  const abiertoEnOtraPestana = (id: number) => tomadoPorOtra(id);

  async function load() {
    try {
      const r = await api.get<{ workspaces: Workspace[]; roots: RootRef[] }>('/api/workspaces');
      list.value = r.workspaces;
      roots.value = r.roots;
      // Un workspace borrado desde otro dispositivo no debe dejar la app
      // apuntando a la nada.
      if (activeId.value !== null && !r.workspaces.some((w) => w.id === activeId.value)) {
        select(null);
      }
      // Con uno solo no tiene sentido preguntar cuál.
      if (activeId.value === null && r.workspaces.length === 1) select(r.workspaces[0].id);
    } catch (e: any) {
      error.value = e?.message || 'No se pudieron leer los workspaces';
    } finally {
      loaded.value = true;
    }
  }

  async function create(name: string, folders: { name?: string; path: string }[]) {
    const w = await api.post<Workspace>('/api/workspaces', { name, folders });
    list.value = [w, ...list.value];
    return w;
  }

  async function update(id: number, patch: { name?: string; folders?: { name?: string; path: string }[] }) {
    const w = await api.patch<Workspace>(`/api/workspaces/${id}`, patch);
    list.value = list.value.map((x) => (x.id === id ? w : x));
    return w;
  }

  async function remove(id: number) {
    await api.del(`/api/workspaces/${id}`);
    list.value = list.value.filter((w) => w.id !== id);
    if (activeId.value === id) select(null);
  }

  return {
    list, roots, activeId, active, loaded, error, pickerOpen, abiertoEnOtraPestana,
    load, select, create, update, remove,
  };
});
