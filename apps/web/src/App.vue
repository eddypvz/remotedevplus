<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, watch } from 'vue';
import ActivityBar from './layout/ActivityBar.vue';
import SideBar from './layout/SideBar.vue';
import Workbench from './layout/Workbench.vue';
import WorkspaceModal from './modules/workspace/WorkspaceModal.vue';
import FolderChoice from './modules/workspace/FolderChoice.vue';
import Login from './Login.vue';
import Loading from './ui/Loading.vue';
import Dialogo from './ui/Dialogo.vue';
import { useSession } from './stores/session';
import { useLayout } from './stores/layout';
import { useTabs } from './stores/tabs';
import { useWorkspaces } from './stores/workspaces';
import { useFiles } from './stores/files';
import { useLauncher } from './stores/launcher';

const session = useSession();
const layout = useLayout();
const tabs = useTabs();
const workspaces = useWorkspaces();
const files = useFiles();
const launcher = useLauncher();

/**
 * Al entrar sin workspace activo hay que elegir uno, y ahí el modal no se
 * puede cerrar: sin workspace el explorador no tiene qué mostrar.
 */
const mustPick = computed(() => (
  session.authenticated && workspaces.loaded && workspaces.activeId === null
));
const showPicker = computed(() => mustPick.value || workspaces.pickerOpen);

/**
 * `inert` sobre el shell mientras hay un modal abierto.
 *
 * Es el primitivo hecho para esto: neutraliza la interacción y saca del orden
 * de foco todo lo que está detrás. Con un terminal abierto importa de verdad —
 * xterm mantiene un textarea oculto enfocado y reacciona a eventos del
 * documento, y esto lo desactiva mientras el modal manda. Funciona porque los
 * modales van teleportados a body, así que quedan fuera del subárbol inerte.
 */
const modalOpen = computed(() => showPicker.value || launcher.asking !== null);

onMounted(async () => {
  layout.restore();
  tabs.restore();
  await session.bootstrap();
  window.addEventListener('resize', layout.onResize);
});

// El panel del sidebar sigue a la pestaña activa cuando pertenece a un módulo.
watch(() => tabs.active?.moduleId ?? null, (m) => layout.seguirALaPestana(m));

// Los workspaces son por usuario, así que se cargan recién con la sesión lista.
watch(() => session.authenticated, async (yes) => {
  if (!yes) return;
  await workspaces.load();
  if (workspaces.activeId !== null) files.openInitial();
}, { immediate: true });

onBeforeUnmount(() => window.removeEventListener('resize', layout.onResize));
</script>

<template>
  <Loading v-if="!session.ready" />
  <Login v-else-if="!session.authenticated" />

  <div v-else class="shell" :inert="modalOpen || undefined">
    <ActivityBar />

    <!--
      El sidebar y el workbench son hermanos: cuando el sidebar es columna
      empuja al workbench, y cuando se superpone (pantalla angosta) el
      workbench conserva todo su ancho. En los dos casos el sidebar arranca
      justo donde termina el rail.
    -->
    <div class="main">
      <SideBar v-if="layout.sidebarVisible" />
      <Workbench />

      <!-- En overlay, tocar fuera cierra el panel: es el gesto que se espera
           en tablet, y evita quedarse sin forma de recuperar el ancho. -->
      <div
        v-if="layout.sidebarVisible && layout.sidebarOverlays"
        class="scrim" @click="layout.toggleSidebar()"
      />
    </div>

  </div>

  <WorkspaceModal
    v-if="showPicker"
    :dismissable="!mustPick"
    @close="workspaces.pickerOpen = false"
  />
  <FolderChoice v-if="launcher.asking" />
  <Dialogo />
</template>

<style scoped>
.shell { display: flex; height: 100dvh; overflow: hidden; }
.main { position: relative; display: flex; flex: 1; min-width: 0; }
.scrim { position: absolute; inset: 0; z-index: 1; background: var(--scrim); }
</style>
