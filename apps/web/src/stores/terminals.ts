import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PtyKind, PtySession } from '@remotedevplus/protocol';
import { api } from '../api';

/** Opciones de lanzamiento; solo tienen efecto en sesiones `claude`. */
export interface LaunchOptions { model?: string; permissionMode?: string }

export const useTerminals = defineStore('terminals', () => {
  const sessions = ref<PtySession[]>([]);

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
   */
  async function adopt(kind: PtyKind, cwd: string, preferId?: string, opts: LaunchOptions = {}) {
    const live = await refresh();
    if (preferId) {
      const exact = live.find((s) => s.id === preferId && s.alive);
      if (exact) return exact;
    }
    const same = live.find((s) => s.kind === kind && s.alive && s.cwd === cwd);
    return same ?? create(kind, cwd, opts);
  }

  async function kill(id: string) {
    await api.del(`/api/pty/${id}`).catch(() => {});
    sessions.value = sessions.value.filter((s) => s.id !== id);
  }

  return { sessions, refresh, create, adopt, kill };
});
