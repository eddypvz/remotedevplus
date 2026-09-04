<script setup lang="ts">
import TabBar from './TabBar.vue';
import Empty from '../ui/Empty.vue';
import { useTabs } from '../stores/tabs';
import { useSession } from '../stores/session';
import { computed } from 'vue';
import { getModule } from '../modules';
import { useLayout } from '../stores/layout';

const tabs = useTabs();
const session = useSession();
const layout = useLayout();

const vacio = computed(() => {
  if (layout.activePanel === 'explorer') {
    return {
      icono: 'files',
      titulo: 'Ningún archivo abierto',
      pista: 'Seleccione uno en el explorador para verlo aquí.',
    };
  }
  if (layout.activePanel === 'search') {
    return {
      icono: 'search',
      titulo: 'Ningún resultado abierto',
      pista: 'Busque algo y toque una coincidencia para abrirla.',
    };
  }
  if (layout.activePanel === 'claude') {
    return {
      icono: 'claude',
      titulo: 'Ninguna conversación abierta',
      pista: 'Elija una del listado o empiece una nueva.',
    };
  }
  return {
    icono: 'files',
    titulo: 'Nada abierto',
    pista: session.can('module:claude')
      ? 'Abra un archivo desde el explorador, o inicie Claude Code desde la barra lateral.'
      : 'Abra un archivo desde el explorador.',
  };
});
</script>

<template>
  <main class="workbench">
    <TabBar v-if="tabs.list.length" />

    <div class="stage">
      <!--
        Cada pestaña se monta UNA vez y se oculta con v-show, no con v-if.

        Desmontar la pestaña de Claude destruiría el xterm y su estado visual.
        El PTY vive en el agente, así que el proceso sobreviviría igual, pero
        habría un repintado innecesario en cada cambio de pestaña.
      -->
      <div
        v-for="tab in tabs.list" :key="tab.key"
        v-show="tab.key === tabs.activeKey"
        class="layer"
        :aria-hidden="tab.key !== tabs.activeKey"
      >
        <component
          :is="getModule(tab.moduleId)!.component"
          :ctx="tab.ctx"
          :tab-key="tab.key"
          :active="tab.key === tabs.activeKey"
        />
      </div>

      <!--
        Sin pestaña activa. El texto sigue al panel abierto: llegar acá desde el
        explorador no es lo mismo que llegar sin haber abierto nada, y decir
        siempre "nada abierto" no orienta.
      -->
      <Empty
        v-if="!tabs.active"
        :icon="vacio.icono"
        :title="vacio.titulo"
        :hint="vacio.pista"
      />
    </div>
  </main>
</template>

<style scoped>
.workbench {
  position: relative;
  display: flex; flex-direction: column;
  flex: 1; min-width: 0; min-height: 0;
  background: var(--bg);
  padding-right: var(--safe-r);
}
.stage { position: relative; flex: 1; min-height: 0; }
.layer { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
</style>
