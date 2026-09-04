import '../apps/agent/src/quiet.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { loadConfig } from '../apps/agent/src/config.js';
import { buildServer, createServices } from '../apps/agent/src/server.js';

/** Actúa con privilegio total, como el CLI. */
export const SUPER = { id: 0, permissions: ['*'] };
export const PASS = 'clave-de-prueba';

/**
 * Un sandbox por archivo de test: su propio directorio temporal y su propia
 * base. Nada compartido entre tests, así que el orden no importa y se pueden
 * correr en paralelo.
 */
export function sandbox(layout = [], files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rdp-test-'));
  for (const d of layout) mkdirSync(join(dir, d), { recursive: true });
  for (const [f, content] of Object.entries(files)) writeFileSync(join(dir, f), content);
  after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    at: (...parts) => join(dir, ...parts),
    link: (from, to) => symlinkSync(join(dir, from), join(dir, to)),
  };
}

/** Servicios del agente contra una base efímera, sin servidor HTTP. */
export function services(sb, roots, extra = []) {
  const args = ['--db', sb.at('test.db'), ...extra];
  for (const [name, path] of Object.entries(roots)) args.push('--root', `${name}=${sb.at(path)}`);
  const cfg = loadConfig(args);
  const svc = createServices(cfg);
  // Sin cierre acá: si el test levanta un servidor, su onClose cierra la base.
  // El directorio temporal se borra igual, así que no queda nada colgado.
  return svc;
}

/** Servidor HTTP en un puerto efímero, con un cliente que arrastra cookies. */
export async function server(svc) {
  const app = await buildServer(svc.cfg, svc);
  await app.listen({ port: 0, host: '127.0.0.1' });
  after(() => app.close());

  const base = `http://127.0.0.1:${app.server.address().port}`;
  const jars = new Map();

  async function as(who, method, path, body) {
    const cookie = jars.get(who);
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: base,
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.()[0];
    if (set) jars.set(who, set.split(';')[0]);
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function login(username, password = PASS) {
    return as(username, 'POST', '/api/auth/login', { username, password });
  }

  return { app, base, as, login, cookieOf: (who) => jars.get(who) };
}

export const q = encodeURIComponent;
