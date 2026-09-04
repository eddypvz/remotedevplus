<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import Icon from '../ui/Icon.vue';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { getModule } from '../modules';

const tabs = useTabs();
const layout = useLayout();

const tira = ref<HTMLElement>();

/**
 * La barra se desplaza hasta la pestaña activa.
 *
 * Con muchas abiertas, una nueva nace fuera de la vista y cambiar de módulo
 * enfoca algo que no se ve: parece que no pasó nada. `inline: 'nearest'` mueve
 * lo mínimo, así que si ya está visible no salta.
 */
watch(() => tabs.activeKey, (k) => {
  if (!k) return;
  nextTick(() => {
    const el = tira.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  });
});

/**
 * El botón de mostrar el panel aparece cuando está oculto por decisión del
 * usuario. Si lo oculta el módulo activo no se muestra: sería un botón que no
 * hace nada.
 */
const showRevealButton = computed(() => !layout.sidebarVisible && !tabs.activeOcultaBarra);
</script>

<template>
  <div class="tabbar">
    <button
      v-if="showRevealButton"
      class="reveal" title="Mostrar el panel" aria-label="Mostrar el panel"
      @click="layout.toggleSidebar()"
    >
      <Icon name="panel" :size="17" />
    </button>

    <div ref="tira" class="strip rdp-scroll">
      <div
        v-for="tab in tabs.list" :key="tab.key"
        :data-key="tab.key"
        class="tab" :class="{ on: tab.key === tabs.activeKey }"
        role="tab" :aria-selected="tab.key === tabs.activeKey"
        :title="getModule(tab.moduleId)?.subtitle?.(tab.ctx) ?? tabs.titleOf(tab)"
        @click="tabs.activate(tab.key)"
        @auxclick.middle.prevent="tabs.close(tab.key)"
      >
        <Icon :name="getModule(tab.moduleId)?.icon ?? 'file'" :size="15" />
        <span class="name">{{ tabs.titleOf(tab) }}</span>
        <button
          class="x" :aria-label="`Cerrar ${tabs.titleOf(tab)}`"
          @click.stop="tabs.close(tab.key)"
        >
          <Icon name="close" :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex; align-items: stretch;
  height: var(--tab-h); flex: 0 0 var(--tab-h);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}

.reveal {
  display: grid; place-items: center;
  width: var(--touch); flex: 0 0 var(--touch);
  color: var(--fg-faint); border-right: 1px solid var(--border);
}
.reveal:hover { color: var(--fg); background: var(--bg-hover); }

.strip {
  display: flex; align-items: stretch;
  min-width: 0; flex: 1;
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none;
}
.strip::-webkit-scrollbar { height: 0; }

.tab {
  display: flex; align-items: center; gap: 7px;
  flex: 0 0 auto; max-width: 15rem;
  padding: 0 6px 0 11px;
  border-right: 1px solid var(--border);
  color: var(--fg-faint);
  cursor: pointer; user-select: none;
  transition: background .1s;
}
.tab:hover { background: var(--bg-hover); }
.tab.on {
  background: var(--bg); color: var(--fg);
  /* La pestaña activa se continúa con el contenido: la línea de abajo se tapa. */
  box-shadow: inset 0 -1px 0 var(--bg), inset 0 2px 0 var(--accent);
}
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

.x {
  display: grid; place-items: center;
  width: 24px; height: 24px; flex: 0 0 24px;
  border-radius: 5px; color: inherit; opacity: 0;
}
.tab:hover .x, .tab.on .x { opacity: .65; }
.x:hover { opacity: 1; background: var(--bg-active); }
/* Sin puntero no hay hover: la X tiene que estar siempre visible y ser grande. */
@media (pointer: coarse) {
  .x { opacity: .6; width: 28px; height: 28px; flex-basis: 28px; }
}
</style>
