import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Tab, TabContext } from '../types';
import { getModule } from '../modules';

/**
 * Las pestañas se guardan **por workspace**.
 *
 * Con una sola clave, dos pestañas del navegador en proyectos distintos se
 * pisaban el conjunto de archivos abiertos. Separadas por workspace cada
 * proyecto conserva el suyo, y cambiar de proyecto trae de vuelta lo que se
 * tenía abierto ahí — que es lo que uno espera de una ventana por proyecto.
 */
const STORAGE = 'rdp.tabs.v1';
const claveDe = (ws: number | null) => (ws === null ? STORAGE : `${STORAGE}:${ws}`);

export const useTabs = defineStore('tabs', () => {
  const list = ref<Tab[]>([]);
  const activeKey = ref<string | null>(null);
  /**
   * Última pestaña usada de cada módulo.
   *
   * Volver al icono de Claude desde git tiene que devolverte a la conversación
   * en la que estabas, no abrir otra ni llevarte a la primera de la lista.
   */
  const ultimaPorModulo = ref(new Map<string, string>());

  const active = computed(() => list.value.find((t) => t.key === activeKey.value) ?? null);
  const activeModule = computed(() => (active.value ? getModule(active.value.moduleId) : null));
  /** El módulo activo pide el ancho completo, sin sidebar. */
  const activeOcultaBarra = computed(() => !!activeModule.value?.ocultaBarra);

  function keyFor(moduleId: string, ctx: TabContext) {
    const def = getModule(moduleId);
    if (def?.singleton) return moduleId;
    // Un archivo o una sesión ya abiertos reenfocan su pestaña en vez de
    // duplicarla, igual que en un editor.
    if (ctx.path) return `${moduleId}:${ctx.path}`;
    if (ctx.sessionId) return `${moduleId}:${ctx.sessionId}`;
    // Una conversación reanudada o ya viva es su propia pestaña; si no, una
    // por carpeta.
    if (ctx.resume) return `${moduleId}:s:${ctx.resume}`;
    if (ctx.conversationId) return `${moduleId}:c:${ctx.conversationId}`;
    if (ctx.cwd) return `${moduleId}:${ctx.cwd}`;
    return `${moduleId}:${Math.random().toString(36).slice(2, 9)}`;
  }

  function open(moduleId: string, ctx: TabContext = {}) {
    const key = keyFor(moduleId, ctx);
    const existing = list.value.find((t) => t.key === key);
    if (existing) {
      // Se refresca el contexto: una sesión de terminal puede haber cambiado.
      existing.ctx = { ...existing.ctx, ...ctx };
    } else {
      list.value.push({ key, moduleId, ctx });
    }
    activeKey.value = key;
    return key;
  }

  function close(key: string) {
    const i = list.value.findIndex((t) => t.key === key);
    if (i < 0) return;
    const cerrada = list.value[i];
    list.value.splice(i, 1);
    if (ultimaPorModulo.value.get(cerrada.moduleId) === key) {
      ultimaPorModulo.value.delete(cerrada.moduleId);
    }
    if (activeKey.value !== key) return;

    /*
     * Se enfoca otra pestaña DEL MISMO MÓDULO, la más cercana. Si no queda
     * ninguna, no se enfoca nada.
     *
     * Caer a la vecina por posición manda a otro módulo: cerrar el último
     * archivo dejaba en git, que no tiene nada que ver con lo que se estaba
     * haciendo. Sin foco aparece el estado vacío del panel abierto —"Ningún
     * archivo abierto"— que sí orienta. Las demás pestañas siguen en la barra.
     */
    const hermanas = list.value.filter((t) => t.moduleId === cerrada.moduleId);
    if (!hermanas.length) {
      activeKey.value = null;
      return;
    }
    activeKey.value = hermanas.reduce((mejor, t) => {
      const d = Math.abs(list.value.indexOf(t) - i);
      return d < Math.abs(list.value.indexOf(mejor) - i) ? t : mejor;
    }).key;
  }

  function activate(key: string) {
    if (list.value.some((t) => t.key === key)) activeKey.value = key;
  }

  /** La última pestaña usada de un módulo, o la última abierta si nunca se usó. */
  function ultimaDe(moduleId: string): string | null {
    const guardada = ultimaPorModulo.value.get(moduleId);
    if (guardada && list.value.some((t) => t.key === guardada)) return guardada;
    const candidatas = list.value.filter((t) => t.moduleId === moduleId);
    return candidatas.length ? candidatas[candidatas.length - 1].key : null;
  }

  /**
   * Deja de mostrar cualquier pestaña, sin cerrar ninguna.
   *
   * Hace falta para salir de un módulo que oculta el sidebar: si no, tocar el
   * explorador desde git no mostraría nada, porque git sigue activo y sigue
   * ocultando la barra.
   */
  function soltar() {
    activeKey.value = null;
  }

  /** Enfoca la pestaña que corresponda de ese módulo. Devuelve si encontró una. */
  function enfocarModulo(moduleId: string): boolean {
    const k = ultimaDe(moduleId);
    if (k) activate(k);
    return !!k;
  }

  watch(activeKey, (k) => {
    const t = list.value.find((x) => x.key === k);
    if (t) ultimaPorModulo.value.set(t.moduleId, t.key);
  });

  function closeOthers(key: string) {
    list.value = list.value.filter((t) => t.key === key);
    activeKey.value = key;
  }

  function move(from: number, to: number) {
    const [t] = list.value.splice(from, 1);
    if (t) list.value.splice(to, 0, t);
  }

  function titleOf(tab: Tab) {
    return getModule(tab.moduleId)?.title(tab.ctx) ?? tab.moduleId;
  }

  /**
   * Se persisten las pestañas abiertas para que al volver a abrir la tablet
   * estén donde estaban. Los PTY siguen vivos en el agente, así que la sesión
   * de Claude se reengancha sola.
   */
  /** El workspace cuyo conjunto de pestañas está cargado ahora. */
  let wsCargado: number | null = null;

  function restore(ws: number | null = null) {
    wsCargado = ws;
    try {
      const raw = localStorage.getItem(claveDe(ws));
      if (!raw) { list.value = []; activeKey.value = null; return; }
      const saved = JSON.parse(raw) as { list: Tab[]; activeKey: string | null };
      list.value = (saved.list || []).filter((t) => getModule(t.moduleId));
      activeKey.value = list.value.some((t) => t.key === saved.activeKey) ? saved.activeKey : list.value[0]?.key ?? null;
    } catch {
      /* localStorage puede fallar en modo privado; no es motivo para no arrancar */
    }
  }

  watch([list, activeKey], () => {
    try {
      localStorage.setItem(claveDe(wsCargado), JSON.stringify({ list: list.value, activeKey: activeKey.value }));
    } catch { /* ídem */ }
  }, { deep: true });

  return {
    list, activeKey, active, activeModule, activeOcultaBarra, ultimaDe, enfocarModulo, soltar,
    open, close, closeOthers, activate, move, titleOf, restore,
  };
});
