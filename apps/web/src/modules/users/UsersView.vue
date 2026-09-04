<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ALL } from '@remotedevplus/protocol';
import type { ManagedUser, UserRoot } from '@remotedevplus/protocol';
import Icon from '../../ui/Icon.vue';
import Loading from '../../ui/Loading.vue';
import UserForm from './UserForm.vue';
import { useUsers } from '../../stores/users';
import { useDialogo } from '../../stores/dialogo';
import { useSession } from '../../stores/session';

const users = useUsers();
const dialogo = useDialogo();
const session = useSession();

const editing = ref<ManagedUser | null | undefined>(undefined);  // undefined = lista
const error = ref('');
const busy = ref(false);

onMounted(() => users.load());

const showing = computed(() => editing.value !== undefined);

function describeRoots(roots: ManagedUser['roots']) {
  if (!roots || !roots.length) return 'las raíces del agente';
  if (typeof roots[0] === 'string') return `${(roots as string[]).join(', ')} (formato antiguo)`;
  const list = roots as UserRoot[];
  if (list.some((r) => r.path === '/')) return 'todo el disco';
  return list.map((r) => r.path).join('  ·  ');
}

async function save(body: Record<string, unknown>) {
  busy.value = true;
  error.value = '';
  try {
    if (editing.value) await users.patch(editing.value.id, body);
    else await users.create(body as any);
    editing.value = undefined;
  } catch (e: any) {
    error.value = e?.message || 'No se pudo guardar';
  } finally {
    busy.value = false;
  }
}

async function toggleDisabled(u: ManagedUser) {
  error.value = '';
  await users.patch(u.id, { disabled: !u.disabled }).catch((e) => { error.value = e?.message; });
}

async function destroy(u: ManagedUser) {
  const ok = await dialogo.confirmar({
    titulo: `Eliminar a ${u.username}`,
    mensaje: 'Sus workspaces y sus sesiones se eliminan con él. Los archivos del disco no se modifican.',
    aceptar: 'Eliminar', peligroso: true,
  });
  if (!ok) return;
  error.value = '';
  await users.remove(u.id).catch((e) => { error.value = e?.message; });
}
</script>

<template>
  <div class="users rdp-scroll">
    <header>
      <div class="title">
        <h1>{{ showing ? (editing ? 'Editar usuario' : 'Nuevo usuario') : 'Usuarios' }}</h1>
        <p v-if="!showing">
          Cada usuario tiene sus permisos y su parte del disco. Un dev nuevo suele
          llevar rol Developer y una carpeta propia, como <code>/var/juan</code>.
        </p>
      </div>
      <button v-if="!showing" class="go" @click="editing = null">
        <Icon name="plus" :size="16" /> Nuevo usuario
      </button>
      <button v-else class="ghost" @click="editing = undefined">
        <Icon name="chevron" :size="15" style="transform: rotate(180deg)" /> Volver
      </button>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <UserForm
      v-if="showing"
      :user="editing ?? null"
      :class="{ busy }"
      @save="save"
      @cancel="editing = undefined"
    />

    <Loading v-else-if="users.loading && !users.list.length" />

    <ul v-else class="list">
      <li v-for="u in users.list" :key="u.id" :class="{ off: u.disabled }">
        <div class="who">
          <span class="nm">
            {{ u.displayName || u.username }}
            <em v-if="u.displayName">{{ u.username }}</em>
            <span v-if="u.id === session.user?.id" class="tag">usted</span>
            <span v-if="u.disabled" class="tag warn">desactivado</span>
          </span>
          <span class="meta">
            <span v-if="u.permissions.includes(ALL)" class="chip admin">super admin</span>
            <span v-else v-for="p in u.permissions" :key="p" class="chip">{{ p }}</span>
          </span>
          <span class="roots">
            <Icon name="folder" :size="13" /> {{ describeRoots(u.roots) }}
          </span>
        </div>

        <div class="acts">
          <button class="mini" title="Editar" @click="editing = u"><Icon name="settings" :size="16" /></button>
          <button
            class="mini" :title="u.disabled ? 'Reactivar' : 'Desactivar y cerrar sus sesiones'"
            @click="toggleDisabled(u)"
          >
            <Icon :name="u.disabled ? 'refresh' : 'logout'" :size="16" />
          </button>
          <button class="mini danger" title="Borrar" @click="destroy(u)"><Icon name="close" :size="16" /></button>
        </div>
      </li>
    </ul>

    <p v-if="!showing" class="foot">
      <Icon name="alert" :size="14" />
      Los permisos los aplica el agente, no esta pantalla. Sin embargo, quien tiene
      <strong>Abrir terminales</strong> alcanza todo lo que alcanza el usuario del
      sistema, sin importar sus raíces. Para aislar de verdad hace falta un agente
      por dev, cada uno con su usuario de sistema.
    </p>
  </div>
</template>

<style scoped>
.users { flex: 1; min-height: 0; padding: 20px 22px 40px; }

header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
.title { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.title p { margin: 5px 0 0; max-width: 40rem; font-size: 12.5px; line-height: 1.6; color: var(--fg-faint); }
code { padding: .1em .35em; border-radius: 4px; background: var(--bg-surface); font: 11.5px var(--mono); }

.go, .ghost {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  height: 36px; padding: 0 14px; border-radius: 8px; font-size: 13px;
}
.go { background: var(--accent); color: var(--on-accent); font-weight: 600; }
.ghost { background: var(--bg-surface); border: 1px solid var(--border-strong); color: var(--fg-dim); }
.ghost:hover { color: var(--fg); }

.list { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; max-width: 46rem; }
.list li {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 8px 11px 14px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px;
}
.list li.off { opacity: .6; }

.who { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
.nm { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 14px; font-weight: 600; }
.nm em { font-style: normal; font-weight: 400; font: 11.5px var(--mono); color: var(--fg-faint); }
.tag {
  padding: 1px 6px; border-radius: 20px; background: var(--bg-active);
  font-size: 10.5px; font-weight: 500; color: var(--fg-faint); text-transform: uppercase;
  letter-spacing: .04em;
}
.tag.warn { background: color-mix(in oklab, var(--warn) 20%, var(--bg)); color: var(--warn); }

.meta { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  padding: 1px 7px; border-radius: 20px;
  background: var(--bg-surface); border: 1px solid var(--border);
  font: 10.5px var(--mono); color: var(--fg-faint);
}
.chip.admin { background: var(--accent-soft); border-color: var(--accent); color: var(--on-accent); }

.roots {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  font: 11px var(--mono); color: var(--fg-faint);
}
.roots :deep(svg) { flex: 0 0 auto; color: var(--accent); }

.acts { display: flex; gap: 2px; flex: 0 0 auto; }
.mini {
  display: grid; place-items: center; width: 34px; height: 34px;
  border-radius: 7px; color: var(--fg-faint);
}
.mini:hover { background: var(--bg-hover); color: var(--fg); }
.mini.danger:hover { color: var(--danger); }

.err { margin: 0 0 14px; padding: 9px 12px; border-radius: 8px; max-width: 46rem;
  background: color-mix(in oklab, var(--danger) 12%, var(--bg)); font-size: 12.5px; color: var(--danger); }

.foot {
  display: flex; align-items: flex-start; gap: 8px;
  max-width: 46rem; margin: 20px 0 0; padding: 11px 13px;
  border: 1px solid var(--border); border-radius: 9px;
  font-size: 12px; line-height: 1.6; color: var(--fg-faint);
}
.foot :deep(svg) { flex: 0 0 auto; margin-top: 2px; color: var(--warn); }
.foot strong { color: var(--fg-dim); }

.busy { opacity: .6; pointer-events: none; }
</style>
