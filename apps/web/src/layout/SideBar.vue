<script setup lang="ts">
import logo from '../images/remotedevplus.png';
import { computed, ref } from 'vue';
import Icon from '../ui/Icon.vue';
import { getPanel } from '../modules';
import { useLayout } from '../stores/layout';

const layout = useLayout();
const panel = computed(() => getPanel(layout.activePanel));

// Redimensionar con puntero y con dedo: pointer events cubren los dos.
const dragging = ref(false);
function startDrag(e: PointerEvent) {
  dragging.value = true;
  const startX = e.clientX;
  const startW = layout.sidebarWidth;
  const move = (ev: PointerEvent) => {
    layout.sidebarWidth = Math.min(Math.max(startW + ev.clientX - startX, 180), 560);
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
</script>

<template>
  <aside
    class="sidebar" :class="{ overlay: layout.sidebarOverlays }"
    :style="{ width: layout.sidebarOverlays ? undefined : layout.sidebarWidth + 'px' }"
  >
    <header class="head">
      <!--
        La marca va acá y no en el rail: el rail mide 46px y el logo es un
        wordmark horizontal, ahí no entra. Chica y algo apagada, porque
        compite por el ancho con el nombre del panel.
      -->
      <img :src="logo" alt="RemoteDev+" class="marca">
      <span class="label">{{ panel?.label ?? '' }}</span>
      <button class="hide" title="Ocultar el panel" aria-label="Ocultar el panel" @click="layout.toggleSidebar()">
        <Icon name="panel" :size="17" />
      </button>
    </header>

    <div class="body">
      <component :is="panel.component" v-if="panel" />
    </div>

    <!-- En overlay el sidebar ocupa un ancho fijo cómodo; redimensionar solo
         tiene sentido cuando es columna. -->
    <div
      v-if="!layout.sidebarOverlays"
      class="grip" :class="{ active: dragging }"
      role="separator" aria-orientation="vertical"
      @pointerdown.prevent="startDrag"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  display: flex; flex-direction: column;
  min-width: 0; flex: 0 0 auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding-bottom: var(--safe-b);
}

/* En angosto se superpone al workbench en vez de empujarlo: en iPad vertical
   una columna fija se come el ancho útil del editor. */
.sidebar.overlay {
  position: absolute; inset: 0 auto 0 0; z-index: 2;
  width: min(84vw, 340px);
  box-shadow: 0 0 0 1px var(--border), 12px 0 32px var(--shadow);
}

.marca {
  height: 13px; width: auto; flex: 0 0 auto;
  opacity: .75; margin-right: 2px;
}

.head {
  display: flex; align-items: center; gap: 8px;
  height: var(--tab-h); flex: 0 0 var(--tab-h);
  padding: 0 4px 0 10px;
  border-bottom: 1px solid var(--border);
}
.label {
  font-size: 11px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase; color: var(--fg-faint);
}
.hide {
  display: grid; place-items: center; margin-left: auto;
  width: var(--touch); height: var(--touch);
  color: var(--fg-faint); border-radius: 6px;
}
.hide:hover { color: var(--fg); background: var(--bg-hover); }

.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.grip {
  position: absolute; top: 0; bottom: 0; right: -3px; width: 7px;
  cursor: col-resize; touch-action: none; z-index: 4;
}
.grip:hover::after, .grip.active::after {
  content: ''; position: absolute; inset: 0 3px; background: var(--accent);
}
</style>
