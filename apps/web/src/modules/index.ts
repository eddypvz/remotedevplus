import { defineAsyncComponent, markRaw } from 'vue';
import type { ActivityItem, ModuleDef, PanelDef } from '../types';
import Loading from '../ui/Loading.vue';

/** Cada módulo llega en su propio chunk: el gestor de git no se descarga hasta abrirlo. */
const lazy = (loader: () => Promise<any>) =>
  markRaw(defineAsyncComponent({ loader, loadingComponent: Loading, delay: 120 }));

const basename = (p?: string) => (p ? p.split('/').filter(Boolean).pop() || p : 'sin título');

export const MODULES: ModuleDef[] = [
  {
    id: 'file',
    requires: 'fs:read',
    icon: 'file',
    title: (ctx) => (ctx.linea ? `${basename(ctx.path)}:${ctx.linea}` : basename(ctx.path)),
    subtitle: (ctx) => ctx.path,
    component: lazy(() => import('./file/FileView.vue')),
  },
  {
    id: 'terminal',
    requires: 'module:terminal',
    icon: 'terminal',
    needsFolder: true,
    title: (ctx) => (ctx.label as string) || 'Terminal',
    subtitle: (ctx) => ctx.cwd as string | undefined,
    component: lazy(() => import('./terminal/TerminalView.vue')),
  },
  {
    id: 'claude',
    requires: 'module:claude',
    icon: 'claude',
    // Pantalla completa: Claude Code se usa leyendo, no de reojo en una columna.
    fullWidth: true,
    needsFolder: true,
    // NO singleton: un workspace de backend + frontend pide un Claude en cada
    // uno, y la pestaña se identifica por su carpeta.
    title: (ctx) => (ctx.label ? `Claude · ${ctx.label}` : 'Claude Code'),
    subtitle: (ctx) => ctx.cwd as string | undefined,
    component: lazy(() => import('./claude/ClaudeView.vue')),
  },
  {
    id: 'claude-native',
    requires: 'module:claude',
    icon: 'claude',
    fullWidth: true,
    needsFolder: true,
    title: (ctx) => {
      const t = ctx.title as string | undefined;
      if (t) return t.length > 28 ? t.slice(0, 27) + '…' : t;
      return ctx.label ? `Claude · ${ctx.label}` : 'Claude';
    },
    subtitle: (ctx) => ctx.cwd as string | undefined,
    component: lazy(() => import('./claude-native/ChatView.vue')),
  },
  {
    id: 'git',
    requires: 'module:git',
    icon: 'git',
    // El motivo de existir del proyecto: el gestor de git a pantalla completa,
    // no una barra angosta al costado.
    fullWidth: true,
    // El árbol necesita todo el ancho, y git ya eligió su carpeta al abrirse.
    ocultaBarra: true,
    needsFolder: true,
    title: (ctx) => (ctx.label ? `Git · ${ctx.label}` : 'Git'),
    subtitle: (ctx) => ctx.cwd as string | undefined,
    component: lazy(() => import('./git/GitView.vue')),
  },
  {
    id: 'db',
    requires: 'module:db',
    icon: 'database',
    fullWidth: true,
    singleton: true,
    title: () => 'Base de datos',
    component: lazy(() => import('./db/DbView.vue')),
  },
  {
    id: 'users',
    requires: 'users:manage',
    icon: 'users',
    fullWidth: true,
    singleton: true,
    title: () => 'Usuarios',
    component: lazy(() => import('./users/UsersView.vue')),
  },
];

export const PANELS: PanelDef[] = [
  {
    id: 'explorer',
    label: 'Explorador',
    icon: 'files',
    requires: 'fs:read',
    component: lazy(() => import('./explorer/ExplorerPanel.vue')),
  },
  {
    id: 'claude',
    label: 'Claude Code',
    icon: 'claude',
    requires: 'module:claude',
    owner: 'claude-native',
    component: lazy(() => import('./claude-native/SessionsPanel.vue')),
  },
  {
    id: 'search',
    label: 'Buscar',
    icon: 'search',
    requires: 'module:search',
    component: lazy(() => import('./search/SearchPanel.vue')),
  },
  {
    id: 'settings',
    label: 'Ajustes',
    icon: 'settings',
    component: lazy(() => import('./settings/SettingsPanel.vue')),
  },
];

export const ACTIVITY: ActivityItem[] = [
  { id: 'explorer', label: 'Explorador', icon: 'files', kind: 'panel', moduleId: 'file', requires: 'fs:read' },
  { id: 'search', label: 'Buscar', icon: 'search', kind: 'panel', requires: 'module:search' },
  { id: 'git', label: 'Git', icon: 'git', kind: 'launcher', moduleId: 'git', requires: 'module:git' },
  // Panel y no lanzador: lo normal es querer seguir una conversación que ya
  // existe, no empezar de cero. El listado vive en el sidebar y desde ahí se
  // abre una nueva.
  // `moduleId` en un panel no lo convierte en lanzador: dice a qué módulo
  // pertenece, para que el icono lleve a la pestaña que ya existe de ese módulo
  // además de abrir su panel.
  { id: 'claude', label: 'Claude Code', icon: 'claude', kind: 'panel', moduleId: 'claude-native', requires: 'module:claude' },
  { id: 'db', label: 'Base de datos', icon: 'database', kind: 'launcher', moduleId: 'db', requires: 'module:db' },
  { id: 'users', label: 'Usuarios', icon: 'users', kind: 'launcher', moduleId: 'users', requires: 'users:manage', slot: 'bottom' },
  { id: 'settings', label: 'Ajustes', icon: 'settings', kind: 'panel', slot: 'bottom' },
];

const byId = new Map(MODULES.map((m) => [m.id, m]));
export const getModule = (id: string) => byId.get(id);
export const getPanel = (id: string) => PANELS.find((p) => p.id === id);
