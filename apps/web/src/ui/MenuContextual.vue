<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import Icon from './Icon.vue';

export interface OpcionMenu {
  id: string;
  etiqueta?: string;
  icono?: string;
  /** Se pinta en rojo: borra algo. */
  peligroso?: boolean;
  deshabilitado?: boolean;
  /** Línea divisoria; no necesita etiqueta. */
  separador?: boolean;
}

/**
 * Menú contextual.
 *
 * Teleportado a `body` porque cualquier ancestro con `overflow` lo recortaría,
 * y el explorador es una lista con scroll — ya pasó dos veces en este proyecto.
 *
 * Se abre donde se tocó, pero se voltea contra el borde de la pantalla en vez
 * de salirse: en una tablet en vertical el menú no entra abajo a la derecha.
 */
const props = defineProps<{ x: number; y: number; opciones: OpcionMenu[] }>();
const emit = defineEmits<{ elegir: [string]; cerrar: [] }>();

const caja = ref<HTMLDivElement>();
const pos = ref({ left: props.x, top: props.y });

onMounted(async () => {
  await nextTick();
  const el = caja.value;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const margen = 8;
  pos.value = {
    left: Math.max(margen, Math.min(props.x, window.innerWidth - width - margen)),
    top: Math.max(margen, Math.min(props.y, window.innerHeight - height - margen)),
  };
  el.focus();
});

function fuera(e: MouseEvent | TouchEvent) {
  if (!caja.value?.contains(e.target as Node)) emit('cerrar');
}

// `capture` para ganarle a los manejadores de las filas de abajo: sin eso, el
// clic que cierra el menú también seleccionaría el archivo que hay detrás.
onMounted(() => {
  document.addEventListener('pointerdown', fuera, true);
  window.addEventListener('resize', () => emit('cerrar'));
  window.addEventListener('blur', () => emit('cerrar'));
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', fuera, true));

function elegir(o: OpcionMenu) {
  if (o.separador || o.deshabilitado) return;
  emit('elegir', o.id);
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="caja" class="menu" role="menu" tabindex="-1"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @keydown.escape="emit('cerrar')"
      @contextmenu.prevent
    >
      <template v-for="(o, i) in opciones" :key="o.id + i">
        <hr v-if="o.separador" class="sep">
        <button
          v-else class="op" role="menuitem"
          :class="{ malo: o.peligroso }" :disabled="o.deshabilitado"
          @click="elegir(o)"
        >
          <Icon v-if="o.icono" :name="o.icono" :size="14" />
          <span v-else class="hueco" />
          {{ o.etiqueta }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.menu {
  position: fixed; z-index: 95;
  min-width: 13rem; max-width: min(20rem, calc(100vw - 16px));
  padding: 5px; border-radius: 11px;
  background: var(--bg-panel); border: 1px solid var(--border);
  box-shadow: 0 16px 40px var(--shadow);
}
.menu:focus { outline: none; }

.op {
  display: flex; align-items: center; gap: 9px;
  width: 100%; min-height: var(--touch); padding: 0 10px;
  border-radius: 7px; font-size: 13px; color: var(--fg); text-align: left;
}
.op:hover:not(:disabled) { background: var(--bg-hover); }
.op:disabled { opacity: .38; cursor: default; }
.op :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); }
.op.malo { color: var(--danger); }
.op.malo :deep(svg) { color: var(--danger); }
.hueco { width: 14px; flex: 0 0 14px; }

.sep { height: 1px; margin: 4px 8px; border: 0; background: var(--border); }
</style>
