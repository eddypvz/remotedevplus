import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { openDb } from './db/index.js';
import { loadConfig } from './config.js';
import { createHosts } from './hosts/local.js';
import { createPathGuard, hasPermission } from './paths.js';
import { createAudit } from './services/audit.js';
import { createAuth } from './services/auth.js';
import { createUsers } from './services/users.js';
import { createPty } from './services/pty.js';
import { createWorkspaces } from './services/workspaces.js';
import { createClaude } from './services/claude.js';
import { createGit } from './services/git.js';
import { createSearch } from './services/search.js';
import { COOKIE } from './server-shared.js';
import authRoutes from './routes/auth.js';
import fsRoutes from './routes/fs.js';
import ptyRoutes from './routes/pty.js';
import userRoutes from './routes/users.js';
import workspaceRoutes from './routes/workspaces.js';
import claudeRoutes from './routes/claude.js';
import gitRoutes from './routes/git.js';
import searchRoutes from './routes/search.js';

export function createServices(cfg) {
  const db = openDb(cfg.dbPath);
  const audit = createAudit(db);
  const auth = createAuth(db, cfg, audit);
  const hosts = createHosts();
  const guard = createPathGuard(cfg);
  const users = createUsers(db, audit, guard);
  const pty = createPty(hosts, cfg, audit);
  const workspaces = createWorkspaces(db, guard, audit);
  const claude = createClaude(db, cfg, audit);
  const git = createGit(hosts, guard, audit);
  const search = createSearch(cfg, guard, audit);
  return { db, audit, auth, users, hosts, guard, pty, workspaces, claude, git, search, cfg };
}

export async function buildServer(cfg = loadConfig(), services = createServices(cfg)) {
  const { auth, pty } = services;

  const app = Fastify({
    trustProxy: cfg.trustProxy,
    logger: { level: process.env.LOG_LEVEL || 'warn' },
    https: cfg.tls
      ? { cert: readFileSync(cfg.tls.cert), key: readFileSync(cfg.tls.key) }
      : null,
  });

  // Un POST o DELETE sin cuerpo pero con content-type json es lo normal desde
  // curl o un script, y Fastify lo rechaza con un 400 bastante confuso
  // (FST_ERR_CTP_EMPTY_JSON_BODY). Se trata el cuerpo vacío como {}.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err);
    }
  });

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // Resuelve la sesión una vez por request y la deja en req.user.
  app.addHook('onRequest', async (req) => {
    req.user = auth.resolve(req.cookies?.[COOKIE]);
  });

  /**
   * Aquí se aplica la autorización, en el agente y no en la UI.
   *
   * Que el frontend esconda el icono de git no es seguridad: si el usuario no
   * tiene `module:git`, este hook es lo que hace que `GET /api/git/status`
   * falle igual cuando lo llaman a mano. Cada ruta declara su permiso en
   * `config.requires` y este hook es el único lugar que lo verifica.
   */
  app.addHook('onRequest', async (req, reply) => {
    const conf = req.routeOptions?.config || {};
    if (conf.public) return;

    const isApi = req.url.startsWith('/api/') || req.url.startsWith('/ws/');
    if (!isApi) return;

    if (!auth.hasUsers()) {
      return reply.code(503).send({
        error: 'setup',
        message: 'No hay usuarios todavía. Cree el primero con: npm run user -- add <nombre> --admin',
      });
    }
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    if (conf.requires && !hasPermission(req.user.permissions, conf.requires)) {
      return reply.code(403).send({ error: 'forbidden', required: conf.requires });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (code >= 500) req.log.error({ err }, 'error no manejado');
    reply.code(code).send({ error: err.code || 'error', message: err.message });
  });

  await app.register(authRoutes, services);
  await app.register(fsRoutes, services);
  await app.register(ptyRoutes, services);
  await app.register(userRoutes, services);
  await app.register(workspaceRoutes, services);
  await app.register(claudeRoutes, services);
  await app.register(gitRoutes, services);
  await app.register(searchRoutes, services);

  // El agente sirve el SPA él mismo. Por eso no hace falta Apache, nginx ni un
  // vhost: `node apps/agent/src/cli.js serve` ya es la app completa.
  const hasBuild = existsSync(join(cfg.webRoot, 'index.html'));
  if (hasBuild) {
    await app.register(fastifyStatic, { root: cfg.webRoot, prefix: cfg.basePath, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!hasBuild) {
      return reply.code(503).type('text/html').send(NO_BUILD_HTML);
    }
    // Fallback de SPA: cualquier ruta que no sea un archivo real la resuelve el
    // index.html, para que recargar una ruta profunda no dé 404.
    return reply.sendFile('index.html');
  });

  app.addHook('onClose', async () => {
    pty.shutdown();
    services.claude.apagar();
    // El cierre tiene que ser idempotente: cerrar el servidor dos veces, o
    // después de que alguien más cerrara la base, no debe tirar la salida.
    try {
      services.db.close();
    } catch {
      /* ya estaba cerrada */
    }
  });

  return app;
}

const NO_BUILD_HTML = `<!doctype html><meta charset="utf-8">
<title>remotedevplus — falta compilar</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui;background:#16181d;color:#c9d1d9;
padding:3rem;max-width:38rem;margin:auto}code{background:#22262e;padding:.15em .4em;
border-radius:4px;color:#7ee787}h1{font-size:1.3rem}</style>
<h1>El agente está arriba, pero falta el build de la web</h1>
<p>El agente sirve <code>apps/web/dist</code> y ese directorio todavía no existe.
Está en <code>.gitignore</code>, así que después de clonar hay que compilar:</p>
<pre><code>npm install
npm run build</code></pre>
<p>Para desarrollar la web con recarga en caliente, <code>npm run dev</code>.</p>`;
