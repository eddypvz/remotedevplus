import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { getPanel } from '../modules';
import { useTabs } from './tabs';

const STORAGE = 'rdp.layout.v1';
/** iPad vertical. Por debajo de esto el sidebar estorba como columna. */
const NARROW = 900;

export const useLayout = defineStore('layout', () => {
  const tabs = useTabs();

  /**
   * Intención del usuario, guardada aparte del estado efectivo.
   *
   * Ese desdoblamiento es la razón de que al cerrar Claude a pantalla completa
   * el sidebar reaparezca solo: nunca se apagó, solo estaba tapado.
   */
  const userWantsSidebar = ref(true);
  const activePanel = ref<string>('explorer');
  const sidebarWidth = ref(272);
  const viewportWidth = ref(window.innerWidth);

  const narrow = computed(() => viewportWidth.value < NARROW);

  /**
   * El sidebar lo controla el usuario, salvo que el módulo activo lo oculte.
   *
   * La intención del usuario se guarda aparte del estado efectivo, así que al
   * salir de un módulo que oculta la barra vuelve como estaba.
   *
   * Esto ya se probó una vez para todos los módulos a pantalla completa y
   * estorbaba —el explorador se quiere abierto mientras se usa Claude Code—,
   * por eso ahora lo declara cada módulo. Solo git lo pide: elige su carpeta al
   * abrirse, así que el explorador al costado no aporta nada y le quita ancho
   * al árbol.
   */
  const sidebarVisible = computed(() => userWantsSidebar.value && !tabs.activeOcultaBarra);

  /** En angosto el sidebar deja de ser columna y se superpone, para no comerse el editor. */
  const sidebarOverlays = computed(() => narrow.value);

  function toggleSidebar() {
    userWantsSidebar.value = !userWantsSidebar.value;
  }

  /** Un icono de panel: si ya está abierto en ese panel, lo cierra. */
  function selectPanel(id: string) {
    if (sidebarVisible.value && activePanel.value === id) {
      userWantsSidebar.value = false;
      return;
    }
    activePanel.value = id;
    userWantsSidebar.value = true;
  }

  function onResize() {
    viewportWidth.value = window.innerWidth;
  }

  /**
   * El panel cede solo cuando el módulo activo oculta la barra.
   *
   * Antes un panel con dueño se retiraba en cuanto su módulo perdía el foco, y
   * eso rompía el flujo real: mirar archivos mientras se conversa con Claude, o
   * volver a Claude sin perder el explorador de vista. Hoy el panel lo elige el
   * usuario y se queda donde lo dejó; lo único que lo cambia es entrar a un
   * módulo donde la barra no se ve.
   */
  function seguirALaPestana(moduleId: string | null) {
    if (!moduleId) return;
    const actual = getPanel(activePanel.value);
    if (!actual?.owner || actual.owner === moduleId) return;
    // Solo se cede si de todos modos la barra va a estar oculta.
    if (tabs.activeOcultaBarra) activePanel.value = 'explorer';
  }

  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      if (typeof s.userWantsSidebar === 'boolean') userWantsSidebar.value = s.userWantsSidebar;
      if (typeof s.activePanel === 'string') activePanel.value = s.activePanel;
      if (typeof s.sidebarWidth === 'number') sidebarWidth.value = Math.min(Math.max(s.sidebarWidth, 180), 560);
    } catch { /* modo privado */ }
  }

  watch([userWantsSidebar, activePanel, sidebarWidth], () => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        userWantsSidebar: userWantsSidebar.value,
        activePanel: activePanel.value,
        sidebarWidth: sidebarWidth.value,
      }));
    } catch { /* ídem */ }
  });

  return {
    userWantsSidebar, activePanel, sidebarWidth, narrow,
    sidebarVisible, sidebarOverlays,
    toggleSidebar, selectPanel, seguirALaPestana, onResize, restore,
  };
});
