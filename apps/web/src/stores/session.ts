import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { hasPermission } from '@remotedevplus/protocol';
import type { Permission, SessionUser } from '@remotedevplus/protocol';
import { api, ApiError } from '../api';

export const useSession = defineStore('session', () => {
  const user = ref<SessionUser | null>(null);
  const ready = ref(false);
  /** El agente no tiene ningún usuario: hay que crear el primero por CLI. */
  const setup = ref(false);
  const setupHint = ref('');
  const error = ref('');

  /**
   * Filtra la UI por permisos. Es conveniencia, NO seguridad: el agente
   * rechaza igual cada ruta según su `requires`. Esconder un icono nunca
   * protegió nada.
   */
  function can(perm: Permission) {
    return hasPermission(user.value?.permissions, perm);
  }

  async function bootstrap() {
    try {
      const r = await api.get<any>('/api/auth/me');
      setup.value = !!r.setup;
      setupHint.value = r.hint || '';
      user.value = r.authenticated ? r.user : null;
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(username: string, password: string) {
    error.value = '';
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/login', { username, password });
      user.value = r.user;
      return true;
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'No se pudo conectar con el agente';
      return false;
    }
  }

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    user.value = null;
  }

  return {
    user, ready, setup, setupHint, error,
    authenticated: computed(() => !!user.value),
    can, bootstrap, login, logout,
  };
});
