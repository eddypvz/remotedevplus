<script setup lang="ts">
import { computed } from 'vue';
import { ALL } from '@remotedevplus/protocol';
import { useSession } from '../../stores/session';
import { useWorkspaces } from '../../stores/workspaces';
import { useSettings } from '../../stores/settings';
import type { ThemePreference } from '../../stores/settings';
import Icon from '../../ui/Icon.vue';

const session = useSession();
const workspaces = useWorkspaces();
const settings = useSettings();

const isAdmin = computed(() => session.user?.permissions.includes(ALL));

const themes: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'Sistema' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
];
</script>

<template>
  <div class="settings rdp-scroll">
    <section>
      <h3>Apariencia</h3>
      <div class="seg" role="radiogroup" aria-label="Tema">
        <button
          v-for="t in themes" :key="t.id"
          class="opt" :class="{ on: settings.theme === t.id }"
          role="radio" :aria-checked="settings.theme === t.id"
          @click="settings.setTheme(t.id)"
        >{{ t.label }}</button>
      </div>
      <p v-if="settings.theme === 'system'" class="note">
        Siguiendo al sistema, ahora en
        <strong>{{ settings.resolvedTheme === 'dark' ? 'oscuro' : 'claro' }}</strong>.
        Si el sistema cambia con la app abierta, cambia con él.
      </p>
    </section>

    <section>
      <h3>Texto</h3>
      <div class="row">
        <span>
          Tamaño de letra
          <em>Se aplica al terminal y a las conversaciones</em>
        </span>
        <div class="stepper">
          <button aria-label="Más chica" @click="settings.setFontSize(settings.fontSize - 1)">−</button>
          <output>{{ settings.fontSize }}</output>
          <button aria-label="Más grande" @click="settings.setFontSize(settings.fontSize + 1)">+</button>
        </div>
      </div>
    </section>

    <section>
      <h3>Escritura</h3>
      <label class="row switch">
        <span>
          Enter envía el mensaje
          <em>Apagado, Enter inserta un salto y se envía con Ctrl+Enter</em>
        </span>
        <input type="checkbox" :checked="settings.enterSends" @change="settings.toggleEnterSends()">
      </label>
      <label class="row switch">
        <span>
          Barra de teclas
          <em>Esc, Tab, Ctrl y flechas — sin ellas Claude Code no se maneja en tablet</em>
        </span>
        <input type="checkbox" :checked="settings.accessoryKeys" @change="settings.toggleAccessoryKeys()">
      </label>
    </section>

    <section>
      <h3>Sesión</h3>
      <dl>
        <dt>usuario</dt>
        <dd>{{ session.user?.displayName || session.user?.username }}</dd>
        <dt>permisos</dt>
        <dd>
          <span v-if="isAdmin" class="chip admin">super admin</span>
          <template v-else>
            <span v-for="p in session.user?.permissions" :key="p" class="chip">{{ p }}</span>
          </template>
        </dd>
      </dl>
      <button class="out" @click="session.logout()">
        <Icon name="logout" :size="15" /> Cerrar sesión
      </button>
    </section>

    <section>
      <h3>Workspace</h3>
      <div class="row">
        <span>
          {{ workspaces.active?.name ?? 'ninguno abierto' }}
          <em v-if="workspaces.active">
            {{ workspaces.active.folders.length }} carpeta{{ workspaces.active.folders.length > 1 ? 's' : '' }}
          </em>
        </span>
        <button class="out" @click="workspaces.pickerOpen = true">Cambiar</button>
      </div>
    </section>

    <section>
      <h3>Raíces del agente</h3>
      <p class="note">
        El límite duro: toda ruta que pide la web se valida contra estos prefijos
        en el agente, y un workspace no puede salirse de acá. Se configuran al
        arrancarlo, con <code>--root</code>.
      </p>
      <ul>
        <li v-for="r in workspaces.roots" :key="r.path">
          <strong>{{ r.name }}</strong><span>{{ r.path }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.settings { flex: 1; min-height: 0; padding: 14px 14px 28px; }
section + section { margin-top: 24px; }
h3 {
  margin: 0 0 9px; font-size: 11px; font-weight: 600;
  letter-spacing: .07em; text-transform: uppercase; color: var(--fg-faint);
}

/* Segmentado: tres opciones exclusivas, cómodo de tocar y legible de un vistazo. */
.seg {
  display: flex; gap: 2px; padding: 2px;
  background: var(--bg-surface);
  border: 1px solid var(--border); border-radius: 9px;
}
.opt {
  flex: 1; height: 32px; border-radius: 7px;
  font-size: 12.5px; color: var(--fg-dim);
}
.opt:hover { color: var(--fg); }
.opt.on {
  background: var(--bg); color: var(--fg); font-weight: 550;
  box-shadow: 0 1px 3px var(--shadow);
}

.row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: var(--touch); font-size: 13px;
}
.row + .row { border-top: 1px solid var(--border); }
.row span { display: flex; flex-direction: column; gap: 2px; }
.row em { font-style: normal; font-size: 11.5px; line-height: 1.45; color: var(--fg-faint); }

.stepper {
  display: flex; align-items: center; flex: 0 0 auto;
  background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: 8px;
}
.stepper button { width: 30px; height: 30px; color: var(--fg-dim); font-size: 15px; }
.stepper button:hover { color: var(--fg); }
.stepper output {
  min-width: 26px; text-align: center;
  font: 12px var(--mono); font-variant-numeric: tabular-nums;
}

.switch { cursor: pointer; }
.switch input { width: 38px; height: 22px; flex: 0 0 auto; accent-color: var(--accent); }

dl { display: grid; grid-template-columns: auto 1fr; gap: 7px 12px; margin: 0 0 12px; font-size: 13px; }
dt { color: var(--fg-faint); }
dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; overflow-wrap: anywhere; }

.chip {
  padding: 1px 7px; border-radius: 20px;
  background: var(--bg-surface); border: 1px solid var(--border);
  font: 11px var(--mono); color: var(--fg-dim);
}
.chip.admin { background: var(--accent-soft); border-color: var(--accent); color: var(--on-accent); }

.out {
  display: flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 12px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 8px; font-size: 13px; color: var(--fg-dim);
}
.out:hover { color: var(--fg); background: var(--bg-active); }

.note { margin: 9px 0 0; font-size: 12px; line-height: 1.6; color: var(--fg-faint); }
.note strong { color: var(--fg-dim); }
code { padding: .1em .35em; border-radius: 4px; background: var(--bg-surface); font: 11px var(--mono); }

ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
li { display: flex; flex-direction: column; font-size: 12px; }
li strong { color: var(--fg); }
li span { font: 11px var(--mono); color: var(--fg-faint); overflow-wrap: anywhere; }
</style>
