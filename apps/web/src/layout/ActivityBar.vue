<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../ui/Icon.vue';
import { ACTIVITY } from '../modules';
import { useLayout } from '../stores/layout';
import { useTabs } from '../stores/tabs';
import { useSession } from '../stores/session';
import { useLauncher } from '../stores/launcher';

const layout = useLayout();
const tabs = useTabs();
const session = useSession();
const launcher = useLauncher();

/**
 * El rail se filtra por permisos. Es UX, no seguridad: el agente rechaza igual
 * cada ruta según su `requires`.
 */
const items = computed(() => ACTIVITY.filter((i) => !i.requires || session.can(i.requires)));
const top = computed(() => items.value.filter((i) => i.slot !== 'bottom'));
const bottom = computed(() => items.value.filter((i) => i.slot === 'bottom'));

/** Un `panel` está activo si su panel se ve; un `launcher`, si su pestaña es la activa. */
function isActive(id: string) {
  const item = items.value.find((i) => i.id === id)!;
  if (item.kind === 'panel') return layout.sidebarVisible && layout.activePanel === id;
  return tabs.active?.moduleId === item.moduleId;
}

/**
 * Qué hace un icono del rail.
 *
 * La regla es una sola: **cambiar de pestaña solo pasa cuando la barra no se
 * puede mostrar de otro modo**, que hoy es únicamente git.
 *
 * En todo lo demás un icono de panel solo abre su panel y deja la pestaña como
 * está. Eso es lo que permite el flujo de mirar archivos mientras se conversa
 * con Claude: se abre el explorador al costado sin salir de la conversación, y
 * el icono de Claude devuelve el panel de conversaciones sin cerrar el archivo
 * que se estaba leyendo.
 */
function activate(id: string) {
  const item = items.value.find((i) => i.id === id)!;

  if (item.kind === 'launcher') {
    if (!(item.moduleId && tabs.enfocarModulo(item.moduleId))) launcher.launch(item.moduleId!);
    return;
  }

  // Desde un módulo que oculta la barra hay que salir de él para que el panel
  // sea visible: se va a la pestaña de ese módulo, o se suelta la activa.
  if (tabs.activeOcultaBarra) {
    if (!(item.moduleId && tabs.enfocarModulo(item.moduleId))) tabs.soltar();
  }
  layout.selectPanel(id);
}

</script>

<template>
  <nav class="rail" aria-label="Barra de actividad">
    <div class="group">
      <button
        v-for="item in top" :key="item.id"
        class="item" :class="{ on: isActive(item.id) }"
        :title="item.label" :aria-label="item.label" :aria-pressed="isActive(item.id)"
        @click="activate(item.id)"
      >
        <Icon :name="item.icon" :size="21" />
      </button>
    </div>

    <div class="group">
      <button
        v-for="item in bottom" :key="item.id"
        class="item" :class="{ on: isActive(item.id) }"
        :title="item.label" :aria-label="item.label" :aria-pressed="isActive(item.id)"
        @click="activate(item.id)"
      >
        <Icon :name="item.icon" :size="21" />
      </button>
      <button class="item" title="Cerrar sesión" aria-label="Cerrar sesión" @click="session.logout()">
        <Icon name="logout" :size="21" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.rail {
  display: flex; flex-direction: column; justify-content: space-between;
  width: var(--rail); flex: 0 0 var(--rail);
  background: var(--bg-rail);
  border-right: 1px solid var(--border);
  padding: calc(var(--safe-t) + 6px) 0 calc(var(--safe-b) + 6px);
  padding-left: var(--safe-l);
  z-index: 3;
}
.group { display: flex; flex-direction: column; align-items: center; gap: 2px; }

.item {
  position: relative;
  display: grid; place-items: center;
  /* Objetivo táctil completo: en iPad un icono de 20px no se acierta. */
  width: var(--rail); height: var(--touch);
  color: var(--fg-faint);
  transition: color .12s;
}
.item:hover { color: var(--fg-dim); }
.item.on { color: var(--fg); }

/* La marca del activo va pegada al borde, como en VS Code: se lee de reojo. */
.item.on::before {
  content: ''; position: absolute; left: 0; top: 15%; bottom: 15%;
  width: 2px; background: var(--accent); border-radius: 0 2px 2px 0;
}
</style>
