import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Migraciones por índice: el user_version de SQLite dice cuántas corrieron.
// Nunca se edita una migración ya publicada, se agrega otra al final.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE,
    display_name TEXT,
    -- JSON array de permisos. '*' es super admin.
    permissions  TEXT    NOT NULL DEFAULT '[]',
    -- JSON array de nombres de raíz, o NULL = todas las configuradas.
    roots        TEXT,
    disabled     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );

  -- Tabla aparte y no una columna de password, para que passkeys entren sin
  -- migrar: un usuario puede tener varias credenciales de distinto tipo.
  CREATE TABLE credentials (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         TEXT    NOT NULL,   -- 'password' | 'passkey'
    secret       TEXT    NOT NULL,   -- password: scrypt$N$r$p$salt$hash
    label        TEXT,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX credentials_user ON credentials(user_id, type);

  -- Sesiones server-side, no JWT: hay que poder revocar de verdad cuando se
  -- desactiva un usuario o se cierra sesión en todos los dispositivos.
  -- Se guarda el sha256 del token, no el token: una fuga de la base no entrega
  -- sesiones vivas.
  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE login_attempts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    ip       TEXT,
    ok       INTEGER NOT NULL,
    at       INTEGER NOT NULL
  );
  CREATE INDEX login_attempts_ip ON login_attempts(ip, at);

  CREATE TABLE audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    user_id INTEGER,
    action  TEXT NOT NULL,
    detail  TEXT,
    ip      TEXT
  );
  CREATE INDEX audit_at ON audit(at);
  `,

  // Workspaces: un conjunto de carpetas con nombre, por usuario.
  //
  // Viven en la base y no en archivos sueltos tipo .code-workspace de VS Code:
  // así siguen al usuario entre dispositivos sin sincronizar nada, y el iPad ve
  // los mismos que la laptop.
  //
  // OJO con la relación con las raíces: un workspace NO otorga acceso. Es una
  // vista. Cada carpeta se valida contra las raíces del agente al guardarla y
  // otra vez al leerla — si no, cualquiera se daría acceso a /etc creando un
  // workspace que apunte ahí.
  `
  CREATE TABLE workspaces (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    -- JSON array de { name, path }
    folders    TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    opened_at  INTEGER
  );
  CREATE UNIQUE INDEX workspaces_user_name ON workspaces(user_id, name);
  CREATE INDEX workspaces_recent ON workspaces(user_id, opened_at DESC);
  `,

  // Índice liviano de las conversaciones del cliente nativo.
  //
  // El historial de verdad lo guarda el propio Claude Code en su JSONL, y se
  // lee con getSessionMessages: duplicarlo acá sería tener dos versiones de la
  // misma cosa. Lo único que hace falta guardar es de QUIÉN es cada sesión,
  // porque todas viven bajo el mismo usuario de sistema y sin esto un usuario
  // vería los resúmenes de las conversaciones de otro.
  `
  CREATE TABLE claude_sessions (
    session_id TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cwd        TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX claude_sessions_user ON claude_sessions(user_id, created_at DESC);
  `,
];

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** node:sqlite devuelve objetos sin prototipo; esto los normaliza. */
export function plain(row) {
  return row ? { ...row } : null;
}
