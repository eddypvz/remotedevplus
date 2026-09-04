// Contrato compartido entre el agente y la web. Sin dependencias y sin build:
// JS plano con tipos en index.d.ts, para que el agente arranque con `node`
// directo y `npx remotedevplus` no necesite compilar nada.

/** Comodín de super admin. */
export const ALL = '*';

/**
 * Permisos como strings planos. Los roles son paquetes con nombre sobre esta
 * misma lista, así que agregar roles después no migra nada.
 */
export const PERMISSIONS = [
  'module:file', 'module:terminal', 'module:claude', 'module:git',
  'module:db', 'module:search', 'module:users',
  'fs:read', 'fs:write',
  'terminal:spawn',
  'git:read', 'git:write',
  'db:read', 'db:write',
  'users:manage', 'audit:read',
];

/** Paquetes de permisos de conveniencia para el CLI. */
export const ROLES = {
  admin: [ALL],
  dev: [
    'module:file', 'module:terminal', 'module:claude', 'module:git',
    'module:search', 'fs:read', 'fs:write', 'terminal:spawn',
    'git:read', 'git:write',
  ],
  reviewer: ['module:git', 'module:search', 'module:file', 'fs:read', 'git:read'],
};

export function hasPermission(permissions, needed) {
  if (!permissions) return false;
  return permissions.includes(ALL) || permissions.includes(needed);
}

export function isValidPermission(p) {
  return p === ALL || PERMISSIONS.includes(p);
}

/**
 * Agrupación de permisos para la UI. Vive acá y no en el frontend para que
 * agregar un permiso nuevo no se olvide en la pantalla de usuarios.
 */
export const PERMISSION_GROUPS = [
  {
    id: 'modules',
    label: 'Qué módulos ve',
    items: [
      { id: 'module:file', label: 'Archivos', hint: 'Explorador y visor' },
      { id: 'module:search', label: 'Buscador' },
      { id: 'module:terminal', label: 'Terminal' },
      { id: 'module:claude', label: 'Claude Code' },
      { id: 'module:git', label: 'Git' },
      { id: 'module:db', label: 'Base de datos' },
    ],
  },
  {
    id: 'files',
    label: 'Archivos',
    items: [
      { id: 'fs:read', label: 'Leer' },
      { id: 'fs:write', label: 'Escribir', hint: 'Guardar, renombrar y borrar' },
    ],
  },
  {
    id: 'exec',
    label: 'Ejecución',
    items: [
      {
        id: 'terminal:spawn',
        label: 'Abrir terminales',
        hint: 'Cuidado: con terminal se alcanza todo lo que alcanza el usuario del sistema, sin importar los demás permisos',
        dangerous: true,
      },
    ],
  },
  {
    id: 'git',
    label: 'Git',
    items: [
      { id: 'git:read', label: 'Leer' },
      { id: 'git:write', label: 'Escribir', hint: 'Commit, stage, push' },
    ],
  },
  {
    id: 'db',
    label: 'Base de datos',
    items: [
      { id: 'db:read', label: 'Leer' },
      { id: 'db:write', label: 'Escribir' },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    items: [
      { id: 'users:manage', label: 'Gestionar usuarios', dangerous: true },
      { id: 'audit:read', label: 'Ver la auditoría' },
    ],
  },
];

/** Descripción de cada rol, para la UI. */
export const ROLE_INFO = {
  admin: { label: 'Super admin', hint: 'Todo, sin excepciones. Incluye gestionar usuarios.' },
  dev: { label: 'Developer', hint: 'Archivos, terminal, Claude Code, git y buscador.' },
  reviewer: { label: 'Revisor', hint: 'Solo lectura: archivos, git y buscador. Sin terminal.' },
};

/**
 * Modelos y modos de permiso que acepta el binario de Claude Code.
 *
 * Se listan acá y el agente valida contra esta lista antes de armar los
 * argumentos: nunca se le pasa al CLI una cadena que venga del navegador.
 */
export const CLAUDE_MODELS = [
  { id: 'default', label: 'Automático', hint: 'El que tenga configurado Claude Code' },
  { id: 'opus', label: 'Opus', hint: 'El más capaz' },
  { id: 'sonnet', label: 'Sonnet', hint: 'Equilibrado' },
  { id: 'fable', label: 'Fable', hint: 'Rápido' },
];

export const CLAUDE_MODES = [
  { id: 'default', label: 'Automático', hint: 'El que tenga configurado Claude Code' },
  { id: 'manual', label: 'Manual', hint: 'Pregunta antes de cada acción' },
  { id: 'acceptEdits', label: 'Aceptar ediciones', hint: 'Edita archivos sin preguntar; para lo demás pregunta' },
  { id: 'plan', label: 'Plan', hint: 'Solo investiga y propone, no modifica nada' },
  { id: 'auto', label: 'Auto', hint: 'Decide solo cuándo preguntar' },
  // Verificado probando los cinco modos: es el único que también se traga las
  // preguntas de Claude (AskUserQuestion), no solo los permisos. La conversación
  // sigue, pero él recibe "the user did not answer".
  { id: 'dontAsk', label: 'Sin preguntar', hint: 'No interrumpe con permisos, y las preguntas de Claude quedan sin responder', dangerous: true },
  { id: 'bypassPermissions', label: 'Saltar permisos', hint: 'Sin ninguna verificación. Con cuidado.', dangerous: true },
];

/**
 * Marcadores de bracketed paste.
 *
 * Son lo que permite tener una caja de texto multilínea de verdad sobre una
 * TUI: un texto envuelto en estos marcadores entra al prompt de Claude Code con
 * sus saltos de línea literales, en vez de que cada Enter lo envíe.
 */
export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';
/** Lo que emite la aplicación al activar y desactivar ese modo. */
export const PASTE_ON = '\x1b[?2004h';
export const PASTE_OFF = '\x1b[?2004l';

/** Tipos de sesión de terminal. `claude` lanza el binario de Claude Code. */
export const PTY_KINDS = ['shell', 'claude'];

/**
 * Protocolo del WebSocket de PTY.
 *
 * Los frames BINARIOS son bytes crudos en las dos direcciones — sin JSON ni
 * base64 en el camino caliente, que es lo que hace que el terminal se sienta
 * instantáneo. Los frames de TEXTO son control en JSON.
 *
 * El `seq` es el offset absoluto en bytes de la salida del PTY desde que nació.
 * El cliente no necesita que se lo manden: cuenta los bytes que recibió. Al
 * reconectar manda `?since=N` y el agente reproduce desde ahí.
 */
export const PTY_CONTROL = {
  /** agente → cliente, primer frame: estado del reattach */
  ATTACHED: 'attached',
  /** agente → cliente: el ring buffer ya no tenía ese offset, hay que limpiar */
  RESET: 'reset',
  /** agente → cliente: el proceso terminó */
  EXIT: 'exit',
  /** cliente → agente: cambió el tamaño del contenedor */
  RESIZE: 'resize',
};

/**
 * Protocolo del WebSocket del cliente nativo de Claude.
 *
 * A diferencia del PTY, acá no viajan bytes de pantalla sino MENSAJES. Eso es
 * todo el punto del módulo: el historial existe como datos y se puede
 * renderizar, buscar y reanudar, cosa que sobre una TUI es imposible.
 */
export const CLAUDE_WS = {
  /** agente → cliente: primer frame, con el estado y desde qué índice se sigue */
  READY: 'ready',
  /** agente → cliente: un SDKMessage tal cual lo emitió el SDK */
  MESSAGE: 'message',
  /**
   * agente → cliente: un pedazo de texto mientras se escribe.
   *
   * No entra al buffer del agente: son cientos por respuesta y el mensaje
   * completo llega detrás. Es puramente para que la respuesta se vea aparecer.
   */
  DELTA: 'delta',
  /** agente → cliente: el turno terminó */
  IDLE: 'idle',
  /**
   * agente → cliente: estado de las tareas en segundo plano.
   *
   * Subagentes y comandos en background sobreviven al turno: el turno termina y
   * el modelo se despierta más tarde con el resultado. Sin este canal todo eso
   * pasaría invisible.
   */
  TASKS: 'tasks',
  /** agente → cliente: hace falta autorizar una herramienta */
  PERMISSION: 'permission',
  /** agente → cliente: la petición de permiso se resolvió o caducó */
  PERMISSION_DONE: 'permission_done',
  /** agente → cliente: cambió el modelo o el modo */
  SETTINGS: 'settings',
  /** agente → cliente: algo falló */
  ERROR: 'error',

  /** cliente → agente: enviar un mensaje del usuario */
  SEND: 'send',
  /** cliente → agente: cortar el turno en curso */
  INTERRUPT: 'interrupt',
  /** cliente → agente: responder una petición de permiso */
  DECIDE: 'decide',
  /** cliente → agente: cambiar modelo o modo en caliente */
  SET: 'set',
  /** cliente → agente: quitar de la lista las tareas ya terminadas */
  OLVIDAR_TAREAS: 'forget_tasks',
};

/** Estados de una conversación nativa. */
export const CLAUDE_STATE = ['inactiva', 'pensando', 'esperando-permiso', 'terminada'];

/** Canal de eventos: lo que el agente empuja sin que se lo pidan. */
export const EVENTS = {
  FS_CHANGED: 'fs:changed',
  PTY_EXIT: 'pty:exit',
  GIT_CHANGED: 'git:changed',
};

/** Límites del protocolo, compartidos para que web y agente no se contradigan. */
export const LIMITS = {
  /** Bytes de scrollback que guarda cada PTY para el replay al reconectar. */
  PTY_RING_BYTES: 512 * 1024,
  /** Archivo más grande que el visor acepta abrir. */
  FILE_READ_MAX: 4 * 1024 * 1024,
  /** Entradas por directorio antes de truncar la respuesta. */
  DIR_ENTRIES_MAX: 5000,
  /** Archivo más grande que se acepta subir, por pieza. */
  FILE_UPLOAD_MAX: 64 * 1024 * 1024,
};
