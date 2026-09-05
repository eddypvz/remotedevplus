<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWorkspaces, type Workspace } from '../../stores/workspaces';
import { useDialogo } from '../../stores/dialogo';
import { useFiles } from '../../stores/files';
import FolderBrowser from './FolderBrowser.vue';
import Icon from '../../ui/Icon.vue';

const props = defineProps<{ dismissable?: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const workspaces = useWorkspaces();
const dialogo = useDialogo();
const files = useFiles();

type View = 'list' | 'edit';
const view = ref<View>('list');
const editing = ref<Workspace | null>(null);
const name = ref('');
const folders = ref<{ name: string; path: string }[]>([]);
const saving = ref(false);
const error = ref('');

const chosen = computed(() => folders.value.map((f) => f.path));
const canSave = computed(() => name.value.trim().length > 0 && folders.value.length > 0);

onMounted(() => {
  if (!workspaces.loaded) workspaces.load();
  // Sin ningún workspace, lo único sensato es empezar creando uno.
  if (workspaces.loaded && !workspaces.list.length) startNew();
});

function startNew() {
  editing.value = null;
  name.value = '';
  folders.value = [];
  error.value = '';
  view.value = 'edit';
}

function startEdit(w: Workspace) {
  editing.value = w;
  name.value = w.name;
  folders.value = w.folders.map((f) => ({ name: f.name, path: f.path }));
  error.value = '';
  view.value = 'edit';
}

function addFolder(path: string, label: string) {
  if (chosen.value.includes(path)) return;
  folders.value = [...folders.value, { name: label, path }];
}

function removeFolder(path: string) {
  folders.value = folders.value.filter((f) => f.path !== path);
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const w = editing.value
      ? await workspaces.update(editing.value.id, { name: name.value.trim(), folders: folders.value })
      : await workspaces.create(name.value.trim(), folders.value);
    open(w);
  } catch (e: any) {
    error.value = e?.message || 'No se pudo guardar';
  } finally {
    saving.value = false;
  }
}

function open(w: Workspace) {
  workspaces.select(w.id);
  files.openInitial();
  emit('close');
}

async function destroy(w: Workspace) {
  const ok = await dialogo.confirmar({
    titulo: 'Eliminar el workspace',
    mensaje: 'Solo se elimina la lista. Las carpetas y su contenido no se tocan.',
    detalle: w.name,
    aceptar: 'Eliminar', peligroso: true,
  });
  if (!ok) return;
  await workspaces.remove(w.id).catch((e) => { error.value = e?.message; });
  if (!workspaces.list.length) startNew();
}
</script>

<template>
  <!--
    Teleport a body a propósito. El modal vivía dentro del shell, y ahí queda a
    merced de cualquier ancestro que cree un contexto de apilado o un bloque
    contenedor. Fuera del shell no hay nada que pueda taparlo ni capturarle los
    eventos.
  -->
  <Teleport to="body">
  <div class="scrim" @click.self="props.dismissable && emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Workspaces">
      <header>
        <button v-if="view === 'edit' && workspaces.list.length" class="back" @click="view = 'list'">
          <Icon name="chevron" :size="15" style="transform: rotate(180deg)" />
        </button>
        <h2>{{ view === 'list' ? 'Workspaces' : (editing ? 'Editar workspace' : 'Nuevo workspace') }}</h2>
        <button v-if="props.dismissable" class="x" aria-label="Cerrar" @click="emit('close')">
          <Icon name="close" :size="16" />
        </button>
      </header>

      <!-- ELEGIR -->
      <div v-if="view === 'list'" class="body">
        <p class="lead">
          Un workspace es un conjunto de carpetas. El explorador muestra solo esas,
          de modo que puede tener el backend y el frontend de un proyecto abiertos
          juntos sin ver todo lo demás.
        </p>

        <ul class="ws">
          <li v-for="w in workspaces.list" :key="w.id" :class="{ on: w.id === workspaces.activeId }">
            <button class="pick" @click="open(w)">
              <span class="nm">
                {{ w.name }}
                <!-- Que se sepa antes de abrirlo: dos pestañas en el mismo
                     proyecto comparten sus archivos abiertos y se pisan. -->
                <em v-if="w.id !== workspaces.activeId && workspaces.abiertoEnOtraPestana(w.id)" class="otra">
                  abierto en otra pestaña
                </em>
              </span>
              <span class="paths">{{ w.folders.map((f) => f.name).join(' · ') || 'sin carpetas disponibles' }}</span>
              <span v-if="w.unavailable" class="warn">
                {{ w.unavailable }} carpeta{{ w.unavailable > 1 ? 's' : '' }} fuera de sus raíces
              </span>
            </button>
            <button class="mini" title="Editar" @click="startEdit(w)"><Icon name="settings" :size="15" /></button>
            <button class="mini danger" title="Borrar" @click="destroy(w)"><Icon name="close" :size="15" /></button>
          </li>
        </ul>

        <button class="new" @click="startNew"><Icon name="plus" :size="16" /> Nuevo workspace</button>
      </div>

      <!-- EDITAR -->
      <div v-else class="body edit">
        <label class="field">
          <span>Nombre</span>
          <input v-model="name" placeholder="proyecto1" maxlength="60" @keydown.enter="canSave && save()">
        </label>

        <div class="field grow">
          <span>Carpetas <em v-if="folders.length">({{ folders.length }})</em></span>

          <ul v-if="folders.length" class="chosen">
            <li v-for="f in folders" :key="f.path">
              <Icon name="folder" :size="15" />
              <input v-model="f.name" class="alias" maxlength="60" aria-label="Nombre a mostrar">
              <span class="p">{{ f.path }}</span>
              <button class="mini" aria-label="Quitar" @click="removeFolder(f.path)">
                <Icon name="close" :size="14" />
              </button>
            </li>
          </ul>
          <p v-else class="lead small">
            Seleccione una o más carpetas abajo. Puede cambiar el nombre con que se
            muestran sin que cambie nada en disco.
          </p>

          <FolderBrowser :roots="workspaces.roots" :chosen="chosen" @pick="addFolder" />
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <footer>
          <button v-if="workspaces.list.length" class="ghost" @click="view = 'list'">Cancelar</button>
          <button class="go" :disabled="!canSave || saving" @click="save">
            {{ saving ? 'guardando…' : (editing ? 'Guardar y abrir' : 'Crear y abrir') }}
          </button>
        </footer>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center; padding: 1.25rem;
  padding-top: calc(1.25rem + var(--safe-t)); padding-bottom: calc(1.25rem + var(--safe-b));
  /*
   * Sin backdrop-filter. Encima de un canvas WebGL —el renderer del terminal—
   * WebKit rompe el hit-testing de lo que está por delante del filtro: el modal
   * se ve pero no recibe los clicks. Era decorativo; el terminal no.
   */
  background: var(--scrim);
}
.modal {
  display: flex; flex-direction: column;
  width: 100%; max-width: 40rem; max-height: 100%;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: 0 24px 60px var(--shadow);
  overflow: hidden;
}

header {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--border);
}
header h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
.back, .x {
  display: grid; place-items: center; width: 30px; height: 30px;
  border-radius: 7px; color: var(--fg-faint);
}
.back:hover, .x:hover { background: var(--bg-hover); color: var(--fg); }

.body { display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 16px; overflow: auto; }
.body.edit { gap: 14px; }

.lead { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--fg-faint); }
.lead.small { margin: 0 0 2px; }

.ws { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.ws li {
  display: flex; align-items: stretch; gap: 2px;
  border: 1px solid var(--border); border-radius: 9px; background: var(--bg);
  overflow: hidden;
}
.ws li.on { border-color: var(--accent); }
.pick {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  flex: 1; min-width: 0; padding: 10px 12px; text-align: left;
}
.pick:hover { background: var(--bg-hover); }
.nm { font-size: 13.5px; font-weight: 550; color: var(--fg); }
.paths {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--fg-faint);
}
.warn { font-size: 11px; color: var(--warn); }

.mini {
  display: grid; place-items: center; width: 36px; flex: 0 0 36px;
  color: var(--fg-faint);
}
.mini:hover { background: var(--bg-hover); color: var(--fg); }
.mini.danger:hover { color: var(--danger); }

.new {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  min-height: var(--touch); border: 1px dashed var(--border-strong);
  border-radius: 9px; color: var(--fg-dim); font-size: 13px;
}
.new:hover { border-color: var(--accent); color: var(--accent); }

.field { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.field.grow { flex: 1; min-height: 0; }
.field > span { font-size: 12px; color: var(--fg-dim); }
.field em { font-style: normal; color: var(--fg-faint); }
.field input {
  height: var(--touch); padding: 0 11px;
  background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: 8px; font-size: 16px;
}
.field input:focus { outline: none; border-color: var(--accent); }

.nm .otra {
  margin-left: 7px; padding: 0 7px; border-radius: 20px;
  background: var(--bg-active); font: 10px var(--mono); font-style: normal;
  color: var(--fg-faint);
}

.chosen { display: flex; flex-direction: column; gap: 4px; margin: 0 0 4px; padding: 0; list-style: none; }
.chosen li {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 4px 4px 10px; border-radius: 8px; background: var(--bg-surface);
}
.chosen :deep(svg) { flex: 0 0 auto; color: var(--accent); }
.alias {
  flex: 0 0 8rem; height: 28px; padding: 0 8px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  font-size: 13px;
}
.chosen .p {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; direction: rtl; text-align: left;
  font: 11px var(--mono); color: var(--fg-faint);
}

.browser { flex: 1; min-height: 12rem; }

footer { display: flex; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }
.go {
  height: 36px; padding: 0 16px; border-radius: 8px;
  background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 13px;
}
.go:disabled { opacity: .45; cursor: default; }
.ghost {
  height: 36px; padding: 0 14px; border-radius: 8px;
  color: var(--fg-dim); font-size: 13px;
}
.ghost:hover { background: var(--bg-hover); color: var(--fg); }

.err { margin: 0; font-size: 12.5px; color: var(--danger); }
</style>
