<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Icon from '../../ui/Icon.vue';
import { useFiles, type TreeRow } from '../../stores/files';
import { useWorkspaces } from '../../stores/workspaces';
import { useTabs } from '../../stores/tabs';
import { useSession } from '../../stores/session';
import { copiar } from '../../ui/portapapeles';

const files = useFiles();
const workspaces = useWorkspaces();
const tabs = useTabs();
const session = useSession();

onMounted(() => { if (!files.rows.length) files.openInitial(); });

function activate(row: TreeRow) {
  if (row.entry.kind === 'dir') files.toggle(row.entry.path);
  else tabs.open('file', { path: row.entry.path });
}

const copiado = ref('');
let relojCopiado: number | undefined;

/**
 * Copia la ruta relativa a su carpeta del workspace.
 *
 * Relativa y no absoluta porque el uso es pegársela a Claude, que entiende
 * `@ruta/relativa` desde su directorio de trabajo. La absoluta queda en el
 * tooltip de la fila.
 */
async function copiarRuta(row: TreeRow) {
  const carpeta = files.folders.find((f) => row.entry.path.startsWith(f.path + '/'));
  const texto = carpeta ? row.entry.path.slice(carpeta.path.length + 1) : row.entry.path;
  const ok = await copiar(texto);
  copiado.value = ok ? texto : 'No se pudo copiar';
  clearTimeout(relojCopiado);
  relojCopiado = setTimeout(() => { copiado.value = ''; }, 2500) as unknown as number;
}

function openTerminalHere(row: TreeRow) {
  const cwd = row.entry.kind === 'dir'
    ? row.entry.path
    : row.entry.path.slice(0, row.entry.path.lastIndexOf('/'));
  tabs.open('terminal', { cwd, label: row.entry.name });
}
</script>

<template>
  <div class="explorer">
    <!-- El workspace activo se cambia desde aquí, sin ir a ajustes: es donde
         está la vista cuando surge la necesidad de otro proyecto. -->
    <button class="switcher" @click="workspaces.pickerOpen = true">
      <span class="nm">{{ workspaces.active?.name ?? 'Sin workspace' }}</span>
      <span class="count" v-if="workspaces.active">
        {{ workspaces.active.folders.length }}
      </span>
      <Icon name="chevron" :size="14" style="transform: rotate(90deg)" />
    </button>

    <div class="tree rdp-scroll" role="tree">
      <div
        v-for="row in files.rows" :key="row.entry.path"
        class="row"
        :class="{ dir: row.entry.kind === 'dir', root: row.depth === 0 }"
        role="treeitem"
        :aria-expanded="row.entry.kind === 'dir' ? row.expanded : undefined"
        :style="{ paddingLeft: 6 + row.depth * 13 + 'px' }"
        :title="row.entry.path"
        @click="activate(row)"
      >
        <span class="twist">
          <Icon
            v-if="row.entry.kind === 'dir'"
            name="chevron" :size="13"
            :style="{ transform: row.expanded ? 'rotate(90deg)' : 'none' }"
          />
        </span>
        <Icon :name="row.entry.kind === 'dir' ? 'folder' : 'file'" :size="15" class="kind" />
        <span class="name">{{ row.entry.name }}</span>
        <button
          class="here" title="Copiar la ruta"
          @click.stop="copiarRuta(row)"
        >
          <Icon name="file" :size="14" />
        </button>
        <button
          v-if="session.can('module:terminal')"
          class="here" title="Abrir una terminal aquí"
          @click.stop="openTerminalHere(row)"
        >
          <Icon name="terminal" :size="14" />
        </button>
      </div>

      <div v-if="!files.rows.length" class="none">
        <p v-if="!workspaces.active">Abra un workspace para ver sus carpetas.</p>
        <p v-else>Este workspace no tiene carpetas disponibles.</p>
        <button @click="workspaces.pickerOpen = true">Seleccionar workspace</button>
      </div>

      <p v-if="files.error" class="err">{{ files.error }}</p>
    </div>

    <p v-if="copiado" class="copiado">
      <Icon name="chevron" :size="13" /> {{ copiado }}
    </p>
  </div>
</template>

<style scoped>
.explorer { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.switcher {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  min-height: 34px; padding: 0 10px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-dim); text-align: left;
}
.switcher:hover { background: var(--bg-hover); color: var(--fg); }
.switcher .nm {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; font-weight: 600;
}
.switcher .count {
  padding: 0 6px; border-radius: 20px; background: var(--bg-active);
  font: 10.5px var(--mono); color: var(--fg-faint);
}

.tree { flex: 1; min-height: 0; padding: 4px 0 12px; }

.row {
  display: flex; align-items: center; gap: 5px;
  /* Objetivo táctil: en iPad una fila de 22px no se acierta con el dedo. */
  min-height: var(--touch); padding-right: 4px;
  color: var(--fg-dim); cursor: pointer; user-select: none;
}
.row:hover { background: var(--bg-hover); color: var(--fg); }
.row.root { font-weight: 600; color: var(--fg); }

.twist { display: grid; place-items: center; width: 14px; flex: 0 0 14px; color: var(--fg-faint); }
.twist :deep(svg) { transition: transform .12s; }
.kind { flex: 0 0 auto; color: var(--fg-faint); }
.row.dir .kind { color: var(--accent); }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

.here {
  display: grid; place-items: center;
  width: 30px; height: 30px; flex: 0 0 30px;
  border-radius: 6px; color: var(--fg-faint); opacity: 0;
}
.row:hover .here { opacity: 1; }
.here:hover { background: var(--bg-active); color: var(--fg); }
@media (pointer: coarse) { .here { opacity: .55; } }

.none {
  display: flex; flex-direction: column; align-items: flex-start; gap: 9px;
  padding: 16px 14px;
}
.none p { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--fg-faint); }
.none button {
  padding: 6px 12px; border-radius: 7px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  font-size: 12.5px; color: var(--fg-dim);
}
.none button:hover { border-color: var(--accent); color: var(--accent); }

.err { margin: 12px; font-size: 12px; color: var(--warn); }

.copiado {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  margin: 0; padding: 7px 12px calc(7px + var(--safe-b));
  border-top: 1px solid var(--border); background: var(--bg-surface);
  font: 11px var(--mono); color: var(--ok);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
