import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { PtyKind, PtySession } from '@remotedevplus/protocol';
import { api } from '../api';
import { useTabs } from './tabs';
import { useEventos } from './eventos';

/** Opciones de lanzamiento; solo tienen efecto en sesiones `claude`. */
export interface LaunchOptions { model?: string; permissionMode?: string }

export const useTerminals = defineStore('terminals', () => {
  const sessions = ref<PtySession[]>([]);

  /** Solo las shells: las de Claude las gobierna su propio módulo. */
  const shells = computed(() => sessions.value.filter((s) => s.kind === 'shell'));

  async function refresh() {
    const r = await api.get<{ sessions: PtySession[] }>('/api/pty');
    sessions.value = r.sessions;
    return r.sessions;
  }

  async function create(kind: PtyKind, cwd: string, opts: LaunchOptions = {}) {
    const s = await api.post<PtySession>('/api/pty', {
      kind, cwd, cols: 80, rows: 24,
      model: opts.model, permissionMode: opts.permissionMode,
    });
    sessions.value = [...sessions.value, s];
    return s;
  }

  /**
   * Reengancha una sesión viva del tipo pedido, o crea una.
   *
   * Es lo que hace que al recargar la página en la tablet la pestaña de Claude
   * vuelva a la MISMA sesión en vez de arrancar otra: el PTY nunca murió, solo
   * se había ido el navegador.
   *
   * `exacto` apaga el rescate por carpeta. Con varias shells en el mismo
   * directorio ese rescate es dañino: dos pestañas huérfanas se engancharían a
   * la misma sesión y se pisarían el teclado. Las shells lo usan; Claude no,
   * porque ahí la carpeta sí identifica la conversación.
   */
  async function adopt(
    kind: PtyKind,
    cwd: string,
    preferId?: string,
    opts: LaunchOptions & { exacto?: boolean } = {},
  ) {
    const live = await refresh();
    if (preferId) {
      const exact = live.find((s) => s.id === preferId && s.alive);
      if (exact) return exact;
    }
    if (!opts.exacto) {
      const same = live.find((s) => s.kind === kind && s.alive && s.cwd === cwd);
      if (same) return same;
    }
    return create(kind, cwd, opts);
  }

  /**
   * Abre una terminal nueva y su pestaña.
   *
   * La sesión se crea ANTES de la pestaña para que la pestaña se identifique
   * por el id del PTY. Así dos terminales en la misma carpeta son dos pestañas
   * distintas —que es justamente lo que se quiere— y el panel puede llevar a la
   * pestaña de cada sesión sin buscarla a tientas.
   */
  async function abrir(cwd: string, label?: string) {
    const tabs = useTabs();
    const s = await create('shell', cwd);
    tabs.open('terminal', { cwd, label: label || nombreDe(cwd), sessionId: s.id });
    return s;
  }

  /** Lleva a la pestaña de una sesión, y la reabre si se había cerrado. */
  function mostrar(s: PtySession) {
    const tabs = useTabs();
    tabs.open('terminal', { cwd: s.cwd, label: nombreDe(s.cwd), sessionId: s.id });
  }

  async function kill(id: string) {
    await api.del(`/api/pty/${id}`).catch(() => {});
    sessions.value = sessions.value.filter((s) => s.id !== id);
  }

  /** Cierra la sesión y también su pestaña: dejarla huérfana no ayuda a nadie. */
  async function cerrar(id: string) {
    const tabs = useTabs();
    const tab = tabs.list.find((t) => t.moduleId === 'terminal' && t.ctx.sessionId === id);
    await kill(id);
    if (tab) tabs.close(tab.key);
  }

  /*
   * Una terminal puede morir sola —un `exit`, un proceso que se cae— y sin este
   * aviso la lista seguiría mostrándola viva hasta el próximo refresh.
   */
  useEventos().onPtyExit((s: PtySession) => {
    sessions.value = sessions.value.map((x) => (x.id === s.id ? { ...x, alive: false } : x));
  });

  return { sessions, shells, refresh, create, adopt, abrir, mostrar, kill, cerrar };
});

const nombreDe = (p: string) => p.split('/').filter(Boolean).pop() || p;
