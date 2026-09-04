export type Permission =
  | '*'
  | 'module:file' | 'module:terminal' | 'module:claude' | 'module:git'
  | 'module:db' | 'module:search' | 'module:users'
  | 'fs:read' | 'fs:write'
  | 'terminal:spawn'
  | 'git:read' | 'git:write'
  | 'db:read' | 'db:write'
  | 'users:manage' | 'audit:read';

export type RoleName = 'admin' | 'dev' | 'reviewer';
export type PtyKind = 'shell' | 'claude';

export const ALL: '*';
export const PERMISSIONS: Permission[];
export const ROLES: Record<RoleName, Permission[]>;
export const PTY_KINDS: PtyKind[];

export interface ClaudeOption {
  id: string;
  label: string;
  hint?: string;
  dangerous?: boolean;
}
export const CLAUDE_MODELS: ClaudeOption[];
export const CLAUDE_MODES: ClaudeOption[];

export const CLAUDE_WS: {
  READY: 'ready'; MESSAGE: 'message'; DELTA: 'delta'; IDLE: 'idle'; TASKS: 'tasks';
  PERMISSION: 'permission';
  PERMISSION_DONE: 'permission_done'; SETTINGS: 'settings'; ERROR: 'error';
  SEND: 'send'; INTERRUPT: 'interrupt'; DECIDE: 'decide'; SET: 'set';
};
export type ClaudeState = 'inactiva' | 'pensando' | 'esperando-permiso' | 'terminada';
export const CLAUDE_STATE: ClaudeState[];

export interface ClaudeConversation {
  id: string;
  sessionId: string | null;
  cwd: string;
  title: string;
  /** El alias elegido: 'default', 'opus', 'sonnet', 'fable'. */
  model: string;
  /** El id real que reporta el SDK, por ejemplo 'claude-opus-5'. */
  actualModel: string | null;
  permissionMode: string;
  state: ClaudeState;
  messages: number;
  createdAt: number;
  /** Acumulado de la conversación, estimado — no es una factura. */
  costUsd: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Estimación en vivo mientras piensa; vuelve a cero al terminar el turno. */
  thinkingTokens: number;
}

export interface ClaudeTask {
  id: string;
  descripcion: string;
  tipo: string;
  estado: 'corriendo' | 'completed' | 'failed' | 'stopped';
  tokens: number;
  herramientas: number;
  resumen?: string;
  salida?: string;
}

export interface ClaudeHistoryEntry {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: number;
  gitBranch?: string;
  mine: boolean;
}

export const PASTE_START: string;
export const PASTE_END: string;
export const PASTE_ON: string;
export const PASTE_OFF: string;

export interface PermissionItem {
  id: Permission;
  label: string;
  hint?: string;
  dangerous?: boolean;
}
export interface PermissionGroup {
  id: string;
  label: string;
  items: PermissionItem[];
}
export const PERMISSION_GROUPS: PermissionGroup[];
export const ROLE_INFO: Record<RoleName, { label: string; hint: string }>;

export function hasPermission(permissions: readonly string[] | null | undefined, needed: Permission | string): boolean;
export function isValidPermission(p: string): boolean;

export const PTY_CONTROL: {
  ATTACHED: 'attached'; RESET: 'reset'; EXIT: 'exit'; RESIZE: 'resize';
};
export const EVENTS: {
  FS_CHANGED: 'fs:changed'; PTY_EXIT: 'pty:exit'; GIT_CHANGED: 'git:changed';
};
export const LIMITS: {
  PTY_RING_BYTES: number; FILE_READ_MAX: number; DIR_ENTRIES_MAX: number;
};

export interface UserRoot { name: string; path: string; host?: string }

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  permissions: Permission[];
  /** null = hereda las raíces del agente. Los strings son la forma legada. */
  roots: UserRoot[] | string[] | null;
}

export interface ManagedUser extends SessionUser {
  disabled: boolean;
  createdAt: number;
  hasPassword: boolean;
}

export interface RootRef { name: string; path: string; host: string }

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  size: number | null;
  mtime: number | null;
}

export interface PtySession {
  id: string;
  kind: PtyKind;
  cwd: string;
  host: string;
  title: string;
  alive: boolean;
  createdAt: number;
  cols: number;
  rows: number;
  bytes: number;
  /** Solo en sesiones `claude`: con qué se lanzó. */
  model?: string;
  permissionMode?: string;
}

export type PtyControl =
  | { t: 'attached'; since: number; dropped: number; cols: number; rows: number }
  | { t: 'reset' }
  | { t: 'exit'; code: number; signal?: number }
  | { t: 'resize'; cols: number; rows: number };
