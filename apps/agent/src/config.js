import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8790,
  // Raíces expuestas. Es la frontera de seguridad del sistema: toda ruta que
  // llega por la API se valida contra estos prefijos.
  roots: [],
  tls: null,          // { cert, key }
  basePath: '/',
  trustProxy: false,
  dbPath: join(REPO_ROOT, 'data', 'remotedevplus.db'),
  webRoot: join(REPO_ROOT, 'apps', 'web', 'dist'),
  shell: process.env.SHELL || '/bin/bash',
  claudeBin: 'claude',
  /** Vacío = el empaquetado con el proyecto. */
  rgBin: null,
  // Idle antes de expirar una sesión. Largo a propósito: una tablet que pide
  // login a diario es una tablet que no se usa.
  sessionTtlDays: 30,
  loginMaxAttempts: 10,
  loginLockoutMinutes: 15,
};

/** `--root /var/www` o `--root www=/var/www` → { name, path, host } */
function parseRoot(spec) {
  const eq = spec.indexOf('=');
  const [name, raw] = eq > 0
    ? [spec.slice(0, eq), spec.slice(eq + 1)]
    : [null, spec];
  const path = resolve(raw.replace(/^~(?=\/|$)/, homedir()));
  return { name: name || path.split('/').filter(Boolean).pop() || 'root', path, host: 'local' };
}

export function loadConfig(argv = []) {
  const cfg = { ...DEFAULTS };

  const file = process.env.REMOTEDEVPLUS_CONFIG || join(REPO_ROOT, 'remotedevplus.config.json');
  if (existsSync(file)) Object.assign(cfg, JSON.parse(readFileSync(file, 'utf8')));

  if (process.env.REMOTEDEVPLUS_PORT) cfg.port = Number(process.env.REMOTEDEVPLUS_PORT);
  if (process.env.REMOTEDEVPLUS_HOST) cfg.host = process.env.REMOTEDEVPLUS_HOST;
  if (process.env.REMOTEDEVPLUS_DB) cfg.dbPath = resolve(process.env.REMOTEDEVPLUS_DB);

  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--root') roots.push(parseRoot(next()));
    else if (a === '--port') cfg.port = Number(next());
    else if (a === '--host') cfg.host = next();
    else if (a === '--tls-cert') cfg.tls = { ...(cfg.tls || {}), cert: resolve(next()) };
    else if (a === '--tls-key') cfg.tls = { ...(cfg.tls || {}), key: resolve(next()) };
    else if (a === '--trust-proxy') cfg.trustProxy = true;
    else if (a === '--base-path') cfg.basePath = next();
    else if (a === '--db') cfg.dbPath = resolve(next());
    else if (a === '--web-root') cfg.webRoot = resolve(next());
    else if (a === '--rg-bin') cfg.rgBin = resolve(next());
    else if (!a.startsWith('-')) roots.push(parseRoot(a));
  }

  // Los flags ganan sobre el archivo de config, y el archivo sobre los defaults.
  if (roots.length) {
    cfg.roots = roots;
  } else {
    cfg.roots = (cfg.roots || []).map((r) => (
      // Del archivo puede venir "/var/www", "www=/var/www" o el objeto entero.
      // En los tres casos hay que resolver la ruta: un `~` sin expandir crearía
      // un directorio llamado "~" en vez de apuntar al home.
      typeof r === 'string' ? parseRoot(r) : parseRoot(`${r.name}=${r.path}`)
    ));
  }

  // Sin raíces no hay nada que servir; el home del usuario es el default menos
  // sorprendente y sigue siendo un límite explícito.
  if (!cfg.roots.length) cfg.roots = [parseRoot(homedir())];

  if (cfg.tls && (!cfg.tls.cert || !cfg.tls.key)) {
    throw new Error('TLS necesita --tls-cert y --tls-key juntos');
  }
  return cfg;
}

export { REPO_ROOT };
