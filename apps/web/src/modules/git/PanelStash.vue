<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../../ui/Icon.vue';
import { useGit } from '../../stores/git';
import { useDialogo } from '../../stores/dialogo';

/**
 * El stash.
 *
 * Se usa sobre todo para no perder cambios antes de un pull, así que lo que
 * importa antes de tocar nada es **qué archivos toca cada entrada** — el
 * mensaje casi nunca alcanza. Por eso vienen listados y no hay que abrir nada
 * para saberlo.
 */
const git = useGit();
const dialogo = useDialogo();
const guardando = ref(false);
const mensaje = ref('');
const abierto = ref<string | null>(null);
const error = ref('');

async function con(fn: () => Promise<unknown>) {
  error.value = '';
  try { await fn(); } catch (e: any) { error.value = e?.message || 'Falló la operación'; }
}

async function guardar() {
  if (!git.hayTrabajo) return;
  guardando.value = true;
  await con(async () => {
    await git.guardarStash(mensaje.value.trim());
    mensaje.value = '';
    await git.cargar(git.cwd!, false);
  });
  guardando.value = false;
}

async function aplicar(ref: string, pop: boolean) {
  await con(async () => {
    await git.aplicarStash(ref, pop);
    await git.cargar(git.cwd!, false);
  });
}

async function borrar(ref: string, resumen: string) {
  const ok = await dialogo.confirmar({
    titulo: 'Eliminar el stash',
    mensaje: 'Los cambios guardados en esta entrada se pierden. No se puede deshacer.',
    detalle: resumen,
    aceptar: 'Eliminar', peligroso: true,
  });
  if (!ok) return;
  await con(() => git.borrarStash(ref));
}

const cuando = (ms: number) => {
  const h = Math.round((Date.now() - ms) / 3600000);
  if (h < 1) return 'recién';
  if (h < 24) return `hace ${h} h`;
  return new Date(ms).toLocaleDateString('es', { day: '2-digit', month: 'short' });
};
</script>

<template>
  <div class="stash">
    <div class="guardar">
      <input
        v-model="mensaje" placeholder="Nombre del stash…"
        :disabled="!git.hayTrabajo"
        @keydown.enter="guardar"
      >
      <button
        class="btn" :disabled="!git.hayTrabajo || guardando"
        :title="git.hayTrabajo ? 'Guarda el trabajo actual en el stash' : 'No hay cambios que guardar'"
        @click="guardar"
      >{{ guardando ? '…' : 'stash' }}</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <p v-if="!git.stashes.length" class="vacio">
      El stash está vacío. Guarde aquí lo que no quiera perder antes de un pull.
    </p>

    <div v-for="s in git.stashes" :key="s.ref" class="entrada">
      <button class="cabeza" @click="abierto = abierto === s.ref ? null : s.ref">
        <Icon name="chevron" :size="12" :style="{ transform: abierto === s.ref ? 'rotate(90deg)' : 'none' }" />
        <span class="que">{{ s.mensaje }}</span>
        <span class="meta">{{ s.archivos.length }} arch · {{ cuando(s.fecha) }}</span>
      </button>

      <ul v-if="abierto === s.ref" class="archivos">
        <li v-for="a in s.archivos" :key="a">{{ a }}</li>
      </ul>

      <div class="acciones">
        <span v-if="s.rama" class="rama">{{ s.rama }}</span>
        <span class="hueco" />
        <button class="chico" title="Aplica y conserva la entrada" @click="aplicar(s.ref, false)">apply</button>
        <button class="chico fuerte" title="Aplica y elimina la entrada" @click="aplicar(s.ref, true)">pop</button>
        <button class="chico mal" title="Eliminar" @click="borrar(s.ref, s.mensaje)">
          <Icon name="close" :size="12" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stash { display: flex; flex-direction: column; gap: 7px; padding: 10px 12px 16px; overflow-y: auto; }

.guardar { display: flex; gap: 6px; }
.guardar input {
  flex: 1; min-width: 0; height: 32px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 8px;
  font-size: 12.5px;
}
.guardar input:focus { outline: none; border-color: var(--accent); }
.guardar input:disabled { opacity: .5; }
.btn {
  flex: 0 0 auto; height: 32px; padding: 0 13px; border-radius: 8px;
  background: var(--accent); color: var(--on-accent); font-size: 12.5px; font-weight: 600;
}
.btn:disabled { background: var(--bg-active); color: var(--fg-faint); cursor: default; }

.entrada {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: 9px; overflow: hidden;
}
.cabeza {
  display: flex; align-items: center; gap: 7px;
  min-height: 34px; padding: 5px 10px; text-align: left;
}
.cabeza:hover { background: var(--bg-hover); }
.cabeza :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); transition: transform .12s; }
.que { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.meta { flex: 0 0 auto; font: 10.5px var(--mono); color: var(--fg-faint); }

.archivos {
  margin: 0; padding: 2px 10px 8px 29px; list-style: none;
  border-top: 1px solid var(--border);
}
.archivos li {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
  font: 11px/1.7 var(--mono); color: var(--fg-faint);
}

.acciones {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px 6px 10px; border-top: 1px solid var(--border);
  background: var(--bg-panel);
}
.rama { font: 10.5px var(--mono); color: var(--fg-faint); }
.hueco { flex: 1; }
.chico {
  padding: 3px 9px; border-radius: 6px; border: 1px solid var(--border-strong);
  font-size: 11px; color: var(--fg-dim);
}
.chico:hover { border-color: var(--accent); color: var(--accent); }
.chico.fuerte { border-color: var(--accent); color: var(--accent); }
.chico.mal { display: grid; place-items: center; width: 26px; padding: 0; height: 24px; }
.chico.mal:hover { border-color: var(--danger); color: var(--danger); }

.vacio { margin: 6px 2px; font-size: 12px; line-height: 1.6; color: var(--fg-faint); }
.err { margin: 0 2px; font-size: 12px; color: var(--danger); }
</style>
