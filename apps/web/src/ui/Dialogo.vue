<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import { useDialogo } from '../stores/dialogo';

const dialogo = useDialogo();
const principal = ref<HTMLButtonElement>();

/**
 * El foco va al botón seguro, no al peligroso.
 *
 * Un Enter reflejo sobre un diálogo que acaba de aparecer no debería borrar
 * nada; por eso en los destructivos el foco arranca en Cancelar.
 */
watch(() => dialogo.abierto, (a) => {
  if (a) nextTick(() => principal.value?.focus());
});

function tecla(e: KeyboardEvent) {
  if (e.key === 'Escape') dialogo.responder(false);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dialogo.abierto && dialogo.pedido" class="scrim"
      @click.self="dialogo.responder(false)" @keydown="tecla"
    >
      <div class="caja" role="alertdialog" aria-modal="true" :aria-label="dialogo.pedido.titulo">
        <header :class="{ malo: dialogo.pedido.peligroso }">
          <Icon :name="dialogo.pedido.peligroso ? 'alert' : 'chevron'" :size="16" />
          <h2>{{ dialogo.pedido.titulo }}</h2>
        </header>

        <p v-if="dialogo.pedido.mensaje" class="mensaje">{{ dialogo.pedido.mensaje }}</p>
        <pre v-if="dialogo.pedido.detalle" class="detalle">{{ dialogo.pedido.detalle }}</pre>

        <footer>
          <button
            v-if="!dialogo.pedido.soloAviso"
            ref="principal"
            class="no" @click="dialogo.responder(false)"
          >{{ dialogo.pedido.cancelar ?? 'Cancelar' }}</button>
          <button
            :ref="(el) => { if (!dialogo.pedido?.peligroso) principal = el as HTMLButtonElement; }"
            class="si" :class="{ malo: dialogo.pedido.peligroso }"
            @click="dialogo.responder(true)"
          >{{ dialogo.pedido.aceptar ?? (dialogo.pedido.soloAviso ? 'Entendido' : 'Aceptar') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 90;
  display: grid; place-items: center; padding: 1.5rem;
  padding-top: calc(1.5rem + var(--safe-t)); padding-bottom: calc(1.5rem + var(--safe-b));
  background: var(--scrim);
}
.caja {
  display: flex; flex-direction: column; gap: 11px;
  width: 100%; max-width: 26rem; padding: 18px 20px 16px;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: 0 24px 60px var(--shadow);
}

header { display: flex; align-items: center; gap: 9px; }
header :deep(svg) { flex: 0 0 auto; color: var(--accent); }
header.malo :deep(svg) { color: var(--danger); }
h2 { margin: 0; font-size: 14.5px; font-weight: 650; line-height: 1.35; }

.mensaje { margin: 0; font-size: 13px; line-height: 1.6; color: var(--fg-dim); }
.detalle {
  margin: 0; padding: 8px 10px; max-height: 9rem; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  font: 11.5px/1.55 var(--mono); color: var(--fg-faint);
  white-space: pre-wrap; overflow-wrap: anywhere;
}

footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
footer button { height: 36px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 550; }
.no { background: var(--bg-surface); border: 1px solid var(--border-strong); color: var(--fg-dim); }
.no:hover { color: var(--fg); }
.si { background: var(--accent); color: var(--on-accent); }
.si.malo { background: var(--danger); color: #fff; }
</style>
