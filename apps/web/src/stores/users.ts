import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ManagedUser, Permission, UserRoot } from '@remotedevplus/protocol';
import { api } from '../api';

export interface UserDraft {
  username: string;
  displayName: string;
  password: string;
  permissions: Permission[];
  roots: UserRoot[] | null;
}

export const useUsers = defineStore('users', () => {
  const list = ref<ManagedUser[]>([]);
  const loading = ref(false);
  const error = ref('');

  async function load() {
    loading.value = true;
    error.value = '';
    try {
      const r = await api.get<{ users: ManagedUser[] }>('/api/users');
      list.value = r.users;
    } catch (e: any) {
      error.value = e?.message || 'No se pudieron leer los usuarios';
    } finally {
      loading.value = false;
    }
  }

  async function create(draft: UserDraft) {
    const u = await api.post<ManagedUser>('/api/users', draft);
    list.value = [...list.value, u].sort((a, b) => a.username.localeCompare(b.username));
    return u;
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const u = await api.patch<ManagedUser>(`/api/users/${id}`, body);
    list.value = list.value.map((x) => (x.id === id ? u : x));
    return u;
  }

  async function remove(id: number) {
    await api.del(`/api/users/${id}`);
    list.value = list.value.filter((u) => u.id !== id);
  }

  return { list, loading, error, load, create, patch, remove };
});
