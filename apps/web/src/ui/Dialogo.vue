<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import { useDialogo } from '../stores/dialogo';

const dialogo = useDialogo();
const principal = ref<HTMLButtonElement>();
const campo = ref<HTMLInputElement | HTMLTextAreaElement>();

/**
 * El foco va al botón seguro, no al peligroso.
 *
 * Un Enter reflejo sobre un diálogo que acaba de aparecer no debería borrar
 * nada; por eso en los destructivos el foco arranca en Cancelar.
 */
watch(() => dialogo.abierto, (a) => {
  if (!a) return;
  nextTick(() => {
    // Con campo de texto el foco va ahí: es lo que se viene a hacer.
    if (!campo.value) { principal.value?.focus(); return; }
    campo.value.focus();
    const v = campo.value.value;
    const punto = v.lastIndexOf('.');
    // Se selecciona solo el nombre, sin la extensión: renombrar `notas.md`
    // casi nunca significa cambiar `.md`.
    if (dialogo.pedido?.entrada?.seleccionarBase && punto > 0) {
      campo.value.setSelectionRange(0, punto);
    } else {
      campo.value.select();
    }
  });
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

        <textarea
          v-if="dialogo.pedido.entrada?.multilinea"
          ref="campo" v-model="dialogo.texto" class="campo alto" rows="4"
          :placeholder="dialogo.pedido.entrada.marcador"
          spellcheck="false" autocapitalize="off" autocorrect="off"
        />
        <input
          v-else-if="dialogo.pedido.entrada"
          ref="campo" v-model="dialogo.texto" class="campo"
          :placeholder="dialogo.pedido.entrada.marcador"
          spellcheck="false" autocapitalize="off" autocorrect="off"
          @keydown.enter.prevent="dialogo.responder(true)"
        >
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
.campo {
  width: 100%; height: 38px; padding: 0 11px;
  background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: 9px; font: 13px var(--mono); color: var(--fg);
}
.campo:focus { outline: none; border-color: var(--accent); }
.campo.alto { height: auto; min-height: 6.5rem; padding: 9px 11px; resize: vertical; line-height: 1.5; }

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
