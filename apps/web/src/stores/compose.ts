import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useTabs } from './tabs';

export interface Draft {
  text: string;
  /** Rutas absolutas; se muestran relativas al cwd de la sesión. */
  attachments: string[];
}

/**
 * Borradores del compositor, uno por pestaña.
 *
 * Viven fuera del componente para dos cosas: que cambiar de pestaña no borre un
 * prompt a medio escribir, y que el explorador pueda adjuntar archivos a una
 * conversación de Claude sin conocer al componente.
 */
export const useCompose = defineStore('compose', () => {
  const tabs = useTabs();
  const drafts = ref(new Map<string, Draft>());

  function get(key: string): Draft {
    if (!drafts.value.has(key)) {
      drafts.value.set(key, { text: '', attachments: [] });
    }
    return drafts.value.get(key)!;
  }

  function setText(key: string, text: string) { get(key).text = text; }
  function clear(key: string) { drafts.value.set(key, { text: '', attachments: [] }); }

  function attachTo(key: string, path: string) {
    const d = get(key);
    if (!d.attachments.includes(path)) d.attachments = [...d.attachments, path];
  }

  function detach(key: string, path: string) {
    const d = get(key);
    d.attachments = d.attachments.filter((p) => p !== path);
  }

  /**
   * Adjunta a la conversación de Claude que corresponda: la activa si lo es, o
   * la única que haya. Con varias abiertas y ninguna activa no se adivina.
   */
  function attachToClaude(path: string): 'ok' | 'ninguna' | 'ambigua' {
    if (tabs.active?.moduleId === 'claude') {
      attachTo(tabs.active.key, path);
      return 'ok';
    }
    const claudes = tabs.list.filter((t) => t.moduleId === 'claude');
    if (!claudes.length) return 'ninguna';
    if (claudes.length > 1) return 'ambigua';
    attachTo(claudes[0].key, path);
    tabs.activate(claudes[0].key);
    return 'ok';
  }

  return { drafts, get, setText, clear, attachTo, detach, attachToClaude };
});
