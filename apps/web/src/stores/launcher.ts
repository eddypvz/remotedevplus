import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useTabs } from './tabs';
import { useWorkspaces } from './workspaces';
import { getModule } from '../modules';
import type { WorkspaceFolder } from './workspaces';

/**
 * Lanzar módulos que necesitan una carpeta de trabajo.
 *
 * Un workspace con backend y frontend no tiene un "cwd obvio", así que hay que
 * preguntar. Con una sola carpeta preguntar sería ruido, y ahí se lanza directo.
 */
export const useLauncher = defineStore('launcher', () => {
  const tabs = useTabs();
  const workspaces = useWorkspaces();

  /** Módulo esperando que se elija carpeta, o null. */
  const asking = ref<string | null>(null);

  const askingModule = computed(() => (asking.value ? getModule(asking.value) : null));
  const folders = computed(() => workspaces.active?.folders ?? []);

  function launch(moduleId: string) {
    const def = getModule(moduleId);
    if (!def) return;

    if (!def.needsFolder) {
      tabs.open(moduleId);
      return;
    }
    if (folders.value.length === 1) {
      pick(folders.value[0], {}, moduleId);
      return;
    }
    if (!folders.value.length) {
      // Sin carpetas no hay dónde abrir nada; que elija workspace primero.
      workspaces.pickerOpen = true;
      return;
    }
    asking.value = moduleId;
  }

  /**
   * `engine` deja cambiar el módulo destino sin cambiar el icono del rail: el
   * mismo botón de Claude abre el cliente nativo o el terminal, según lo que se
   * elija en el diálogo.
   */
  function pick(
    folder: WorkspaceFolder,
    opts: { engine?: string } = {},
    moduleId = asking.value,
  ) {
    const destino = opts.engine || moduleId;
    if (!destino) return;
    asking.value = null;
    tabs.open(destino, { cwd: folder.path, label: folder.name });
  }

  function cancel() { asking.value = null; }

  return { asking, askingModule, folders, launch, pick, cancel };
});
