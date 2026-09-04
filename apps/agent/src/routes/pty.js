import { PTY_CONTROL } from '@remotedevplus/protocol';
import { hasPermission } from '../paths.js';

export default async function ptyRoutes(app, { pty, guard, cfg }) {
  /** El permiso depende del tipo: `module:claude` no implica shell suelta. */
  function permissionFor(kind) {
    return kind === 'claude' ? 'module:claude' : 'module:terminal';
  }

  app.get('/api/pty', { config: { requires: 'terminal:spawn' } }, async () => ({
    sessions: pty.list(),
  }));

  app.post('/api/pty', { config: { requires: 'terminal:spawn' } }, async (req) => {
    const { kind = 'shell', cwd, host, cols, rows, model, permissionMode } = req.body || {};
    if (!hasPermission(req.user.permissions, permissionFor(kind))) {
      const err = new Error(`Falta el permiso ${permissionFor(kind)}`);
      err.statusCode = 403;
      throw err;
    }
    // El cwd pasa por la misma frontera que los archivos: no se puede abrir una
    // terminal fuera de las raíces permitidas.
    const resolved = await guard.resolvePath(req.user, cwd || req.user.roots?.[0] || '.', { mustExist: true });
    return pty.create(
      { kind, cwd: resolved.path, host: host || resolved.host, cols, rows, model, permissionMode },
      req.user,
    );
  });

  app.delete('/api/pty/:id', { config: { requires: 'terminal:spawn' } }, async (req) => (
    pty.kill(req.params.id, req.user)
  ));

  app.get('/ws/pty/:id', { websocket: true, config: { requires: 'terminal:spawn' } }, (socket, req) => {
    // El hook global ya resolvió la cookie y validó el permiso, pero el upgrade
    // de WebSocket no está sujeto a la política de same-origin del navegador:
    // sin este chequeo, cualquier página podría abrir un socket con la cookie
    // del usuario y quedarse con una shell.
    if (!originAllowed(req, cfg)) {
      socket.close(1008, 'Origen no permitido');
      return;
    }

    const { id } = req.params;
    const since = Number(req.query.since ?? 0);

    let session;
    try {
      session = pty.attach(id, socket, since);
    } catch (err) {
      socket.close(1011, err.message || 'No se pudo adjuntar');
      return;
    }

    socket.on('message', (data, isBinary) => {
      // Binario = teclas del usuario, camino caliente sin parseo.
      // Texto = control en JSON.
      if (isBinary) {
        pty.write(id, Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t === PTY_CONTROL.RESIZE) pty.resize(id, msg.cols, msg.rows);
    });

    // Al cerrarse el socket NO se mata el PTY: eso es justamente lo que permite
    // que el iPad suspenda la pestaña y Claude Code siga trabajando.
    socket.on('close', () => pty.detach(id, socket));
    socket.on('error', () => pty.detach(id, socket));
  });
}

/**
 * Un Origin ausente es un cliente no-navegador (curl, un script): se permite,
 * porque ahí la cookie no viaja sola y el riesgo de CSRF no aplica. Un Origin
 * presente tiene que coincidir con el Host por el que entró el request.
 */
function originAllowed(req, cfg) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (cfg.allowedOrigins?.length) return cfg.allowedOrigins.includes(origin);
  try {
    const o = new URL(origin);
    return o.host === req.headers.host;
  } catch {
    return false;
  }
}

export { originAllowed };
