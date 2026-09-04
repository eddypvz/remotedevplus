<script setup lang="ts">
import { computed, ref } from 'vue';
import type { UserRoot } from '@remotedevplus/protocol';
import Icon from '../../ui/Icon.vue';
import FolderBrowser from '../workspace/FolderBrowser.vue';
import { useWorkspaces } from '../../stores/workspaces';
import { useSession } from '../../stores/session';

/**
 * Editor de raíces de un usuario.
 *
 * `null` significa "hereda las del agente", que es distinto de una lista vacía
 * y hay que poder expresarlo. Y el navegador de carpetas solo muestra lo que el
 * ADMINISTRADOR alcanza: el agente rechaza otorgar fuera de eso, así que la UI
 * no ofrece lo que va a fallar.
 */
const model = defineModel<UserRoot[] | null>({ required: true });

const workspaces = useWorkspaces();
const session = useSession();
const browsing = ref(false);
const manual = ref('');

const isSuperAdmin = computed(() => session.can('*'));
const inherits = computed(() => model.value === null);
const rows = computed(() => model.value ?? []);
const chosen = computed(() => rows.value.map((r) => r.path));

function inherit() { model.value = null; }
function customize() { model.value = rows.value.length ? rows.value : []; }

function add(path: string, name: string) {
  if (chosen.value.includes(path)) return;
  model.value = [...rows.value, { name, path }];
}

function addManual() {
  const p = manual.value.trim();
  if (!p) return;
  add(p, p.split('/').filter(Boolean).pop() || p);
  manual.value = '';
}

function drop(path: string) {
  model.value = rows.value.filter((r) => r.path !== path);
}
</script>

<template>
  <div class="roots">
    <div class="mode">
      <button class="chip" :class="{ on: inherits }" @click="inherit">
        Las del agente
      </button>
      <button class="chip" :class="{ on: !inherits }" @click="customize">
        Rutas propias
      </button>
    </div>

    <p v-if="inherits" class="note">
      Verá lo mismo que se le pasó al agente al arrancar
      (<code v-for="r in workspaces.roots" :key="r.path">{{ r.path }}</code>).
      Para asignarle una carpeta propia, seleccione <strong>rutas propias</strong>.
    </p>

    <template v-else>
      <ul v-if="rows.length" class="list">
        <li v-for="r in rows" :key="r.path">
          <Icon name="folder" :size="15" />
          <input v-model="r.name" class="alias" maxlength="40" aria-label="Nombre a mostrar">
          <span class="p">{{ r.path }}</span>
          <button class="mini" aria-label="Quitar" @click="drop(r.path)">
            <Icon name="close" :size="14" />
          </button>
        </li>
      </ul>
      <p v-else class="note warn">
        Sin ninguna raíz no verá ningún archivo.
      </p>

      <div class="add">
        <button class="ghost" @click="browsing = !browsing">
          <Icon name="folder" :size="15" /> {{ browsing ? 'Cerrar navegador' : 'Elegir carpeta' }}
        </button>
        <template v-if="isSuperAdmin">
          <input
            v-model="manual" placeholder="/var/juan" spellcheck="false"
            @keydown.enter.prevent="addManual"
          >
          <button class="ghost" :disabled="!manual.trim()" @click="addManual">Agregar</button>
        </template>
      </div>

      <p v-if="isSuperAdmin" class="note">
        Como super admin puede escribir cualquier ruta existente —
        <code>/</code> le da el disco entero.
      </p>
      <p v-else class="note">
        Solo puede otorgar carpetas dentro de las suyas. El agente rechaza el resto.
      </p>

      <FolderBrowser
        v-if="browsing"
        class="browser" :roots="workspaces.roots" :chosen="chosen" @pick="add"
      />
    </template>
  </div>
</template>

<style scoped>
.roots { display: flex; flex-direction: column; gap: 9px; min-height: 0; }

.mode { display: flex; gap: 2px; padding: 2px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 9px; }
.chip { flex: 1; height: 30px; border-radius: 7px; font-size: 12.5px; color: var(--fg-dim); }
.chip:hover { color: var(--fg); }
.chip.on { background: var(--bg); color: var(--fg); font-weight: 550; box-shadow: 0 1px 3px var(--shadow); }

.list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.list li {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 4px 4px 10px; border-radius: 8px; background: var(--bg-surface);
}
.list :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.alias {
  flex: 0 0 7rem; height: 28px; padding: 0 8px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 13px;
}
.p {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left; font: 11px var(--mono); color: var(--fg-faint);
}
.mini { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; color: var(--fg-faint); }
.mini:hover { background: var(--bg-hover); color: var(--danger); }

.add { display: flex; gap: 6px; flex-wrap: wrap; }
.add input {
  flex: 1 1 9rem; min-width: 0; height: 32px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 7px;
  font: 12px var(--mono);
}
.add input:focus { outline: none; border-color: var(--accent); }
.ghost {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  height: 32px; padding: 0 11px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 7px; font-size: 12.5px; color: var(--fg-dim);
}
.ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ghost:disabled { opacity: .45; cursor: default; }

.browser { min-height: 13rem; max-height: 20rem; }

.note { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--fg-faint); }
.note.warn { color: var(--warn); }
.note code { padding: .1em .3em; border-radius: 3px; background: var(--bg-surface); font: 11px var(--mono); }
.note code + code { margin-left: 4px; }
</style>
