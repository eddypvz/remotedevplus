<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { PERMISSION_GROUPS, ROLE_INFO, ROLES, ALL } from '@remotedevplus/protocol';
import type { ManagedUser, Permission, RoleName, UserRoot } from '@remotedevplus/protocol';
import Icon from '../../ui/Icon.vue';
import RootsEditor from './RootsEditor.vue';
import { useSession } from '../../stores/session';

const props = defineProps<{ user: ManagedUser | null }>();
const emit = defineEmits<{
  (e: 'save', body: Record<string, unknown>): void;
  (e: 'cancel'): void;
}>();

const session = useSession();
const isNew = computed(() => !props.user);

const username = ref('');
const displayName = ref('');
const password = ref('');
const permissions = ref<Permission[]>([]);
const roots = ref<UserRoot[] | null>(null);

/** Un rol es solo un preset: al marcar un permiso suelto pasa a "personalizado". */
const roleNames = Object.keys(ROLES) as RoleName[];
const matchedRole = computed<RoleName | null>(() => {
  const mine = [...permissions.value].sort().join('|');
  return roleNames.find((r) => [...ROLES[r]].sort().join('|') === mine) ?? null;
});

function applyRole(role: RoleName) {
  permissions.value = [...ROLES[role]];
  // Un super admin nuevo lo natural es que vea todo el disco; se puede cambiar.
  if (role === 'admin' && isNew.value) roots.value = [{ name: 'disco', path: '/' }];
}

function toggle(p: Permission) {
  const has = permissions.value.includes(p);
  // Salir de super admin sin dejar la lista vacía sería confuso: se aterriza en dev.
  if (permissions.value.includes(ALL)) permissions.value = [...ROLES.dev];
  permissions.value = has
    ? permissions.value.filter((x) => x !== p)
    : [...permissions.value, p];
}

const isSuper = computed(() => permissions.value.includes(ALL));
/** No se puede otorgar lo que uno no tiene: el agente lo rechaza igual. */
const canGrant = (p: Permission) => session.can('*') || session.can(p);

const valid = computed(() => (
  (!isNew.value || (/^[a-z0-9_.-]{2,32}$/i.test(username.value) && password.value.length >= 8))
  && (isNew.value || !password.value || password.value.length >= 8)
  && permissions.value.length > 0
));

watch(() => props.user, (u) => {
  username.value = u?.username ?? '';
  displayName.value = u?.displayName ?? '';
  password.value = '';
  permissions.value = u ? [...(u.permissions as Permission[])] : [...ROLES.dev];
  // La forma legada (nombres) no se puede editar acá; se ofrece heredar.
  const r = u?.roots;
  roots.value = !r || typeof r[0] === 'string' ? null : (r as UserRoot[]).map((x) => ({ ...x }));
}, { immediate: true });

function submit() {
  const body: Record<string, unknown> = {
    permissions: permissions.value,
    roots: roots.value,
    displayName: displayName.value.trim() || null,
  };
  if (isNew.value) {
    body.username = username.value.trim();
    body.password = password.value;
  } else if (password.value) {
    body.password = password.value;
  }
  emit('save', body);
}
</script>

<template>
  <form class="form" @submit.prevent="valid && submit()">
    <div class="grid">
      <label class="field">
        <span>Usuario</span>
        <input
          v-if="isNew" v-model="username" autocapitalize="off" autocorrect="off"
          spellcheck="false" placeholder="juan"
        >
        <output v-else class="fixed">{{ user!.username }}</output>
      </label>
      <label class="field">
        <span>Nombre a mostrar <em>opcional</em></span>
        <input v-model="displayName" placeholder="Juan Pérez" maxlength="60">
      </label>
    </div>

    <label class="field">
      <span>Contraseña <em v-if="!isNew">déjela vacía para no cambiarla</em></span>
      <input
        v-model="password" type="password" autocomplete="new-password"
        :placeholder="isNew ? 'mínimo 8 caracteres' : '••••••••'"
      >
      <em v-if="!isNew && password" class="warn">Cambiarla cierra todas sus sesiones.</em>
    </label>

    <div class="field">
      <span>Rol</span>
      <div class="roles">
        <button
          v-for="r in roleNames" :key="r" type="button"
          class="role" :class="{ on: matchedRole === r }"
          :disabled="!canGrant(ROLES[r][0] as Permission) && r === 'admin' && !session.can('*')"
          @click="applyRole(r)"
        >
          <strong>{{ ROLE_INFO[r].label }}</strong>
          <em>{{ ROLE_INFO[r].hint }}</em>
        </button>
        <div class="role" :class="{ on: matchedRole === null }">
          <strong>Personalizado</strong>
          <em>Lo que se marque abajo a mano.</em>
        </div>
      </div>
    </div>

    <div class="field">
      <span>Permisos</span>
      <p v-if="isSuper" class="allnote">
        <Icon name="alert" :size="15" />
        Super admin: todos los permisos, presentes y los que se agreguen después.
        Marcar cualquier casilla lo baja a Developer.
      </p>
      <div class="perms">
        <fieldset v-for="g in PERMISSION_GROUPS" :key="g.id">
          <legend>{{ g.label }}</legend>
          <label
            v-for="it in g.items" :key="it.id"
            class="perm" :class="{ off: !canGrant(it.id) }"
            :title="canGrant(it.id) ? it.hint : 'No puede otorgar un permiso que no posee'"
          >
            <input
              type="checkbox" :disabled="!canGrant(it.id)"
              :checked="isSuper || permissions.includes(it.id)"
              @change="toggle(it.id)"
            >
            <span>
              {{ it.label }}
              <em v-if="it.hint" :class="{ danger: it.dangerous }">{{ it.hint }}</em>
            </span>
          </label>
        </fieldset>
      </div>
    </div>

    <div class="field">
      <span>Raíces <em>qué parte del disco alcanza</em></span>
      <RootsEditor v-model="roots" />
    </div>

    <footer>
      <button type="button" class="ghost" @click="emit('cancel')">Cancelar</button>
      <button class="go" type="submit" :disabled="!valid">
        {{ isNew ? 'Crear usuario' : 'Guardar cambios' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 18px; max-width: 46rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 14px; }

.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field > span { font-size: 12px; font-weight: 550; color: var(--fg-dim); }
.field em { font-style: normal; font-weight: 400; font-size: 11.5px; color: var(--fg-faint); }
.field em.warn { color: var(--warn); }
.field input[type="text"], .field input[type="password"], .field input:not([type]) {
  height: var(--touch); padding: 0 11px;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 8px;
  font-size: 16px;
}
.field input:focus { outline: none; border-color: var(--accent); }
.fixed {
  display: flex; align-items: center; height: var(--touch); padding: 0 11px;
  background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
  font: 14px var(--mono); color: var(--fg-dim);
}

.roles { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 7px; }
.role {
  display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
  padding: 9px 11px; text-align: left;
  background: var(--bg); border: 1px solid var(--border); border-radius: 9px;
}
.role strong { font-size: 13px; font-weight: 600; color: var(--fg); }
.role em { font-style: normal; font-size: 11.5px; line-height: 1.45; color: var(--fg-faint); }
button.role:hover:not(:disabled) { border-color: var(--border-strong); }
.role.on { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 7%, var(--bg)); }
button.role:disabled { opacity: .45; cursor: default; }

.allnote {
  display: flex; align-items: flex-start; gap: 8px; margin: 0;
  padding: 9px 11px; border-radius: 8px;
  background: color-mix(in oklab, var(--warn) 12%, var(--bg));
  font-size: 12px; line-height: 1.55; color: var(--fg-dim);
}
.allnote :deep(svg) { flex: 0 0 auto; margin-top: 1px; color: var(--warn); }

.perms { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 12px; }
fieldset { margin: 0; padding: 0; border: 0; }
legend {
  padding: 0 0 5px; font-size: 11px; font-weight: 600;
  letter-spacing: .05em; text-transform: uppercase; color: var(--fg-faint);
}
.perm {
  display: flex; align-items: flex-start; gap: 8px;
  min-height: 30px; padding: 3px 0; font-size: 13px; cursor: pointer;
}
.perm.off { opacity: .45; cursor: not-allowed; }
.perm input { width: 17px; height: 17px; margin-top: 2px; flex: 0 0 17px; accent-color: var(--accent); }
.perm > span { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.perm em { font-style: normal; font-size: 11px; line-height: 1.45; color: var(--fg-faint); }
.perm em.danger { color: var(--warn); }

footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.go {
  height: 38px; padding: 0 18px; border-radius: 8px;
  background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 13px;
}
.go:disabled { opacity: .45; cursor: default; }
.ghost { height: 38px; padding: 0 14px; border-radius: 8px; color: var(--fg-dim); font-size: 13px; }
.ghost:hover { background: var(--bg-hover); color: var(--fg); }
</style>
