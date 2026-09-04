import { CLAUDE_WS } from '@remotedevplus/protocol';
import { originAllowed } from './pty.js';

export default async function claudeRoutes(app, { claude, guard, cfg }) {
  const R = { config: { requires: 'module:claude' } };

  app.get('/api/claude', R, async (req) => ({ conversations: claude.lista(req.user) }));

  app.post('/api/claude', R, async (req) => {
    const { cwd, model, permissionMode, resume, title } = req.body || {};
    // El cwd pasa por la misma frontera que los archivos: no se abre una
    // conversación fuera de las raíces del usuario.
    const r = await guard.resolvePath(req.user, cwd, { mustExist: true });
    return claude.crear({ cwd: r.path, model, permissionMode, resume, title }, req.user);
  });

  /** Conversaciones pasadas de una carpeta, leídas del almacén de Claude Code. */
  app.get('/api/claude/history', R, async (req) => {
    // Acepta cwd repetido: el panel lista las sesiones de todas las carpetas
    // del workspace de una sola vez. Cada una pasa por la frontera igual.
    const pedidas = [].concat(req.query.cwd ?? []);
    if (!pedidas.length) throw Object.assign(new Error('Falta cwd'), { statusCode: 400 });
    const rutas = [];
    for (const c of pedidas) {
      rutas.push((await guard.resolvePath(req.user, c, { mustExist: true })).path);
    }
    return { sessions: await claude.historial(req.user, rutas) };
  });

  app.get('/api/claude/history/:sessionId', R, async (req) => ({
    messages: await claude.mensajes(req.user, req.params.sessionId),
  }));

  app.patch('/api/claude/history/:sessionId', R, async (req) => (
    claude.renombrar(req.user, req.params.sessionId, req.body?.title)
  ));

  app.delete('/api/claude/history/:sessionId', R, async (req) => (
    claude.borrarHistorial(req.user, req.params.sessionId)
  ));

  app.patch('/api/claude/:id', R, async (req) => (
    claude.ajustar(req.params.id, req.body || {}, req.user)
  ));

  app.delete('/api/claude/:id', R, async (req) => claude.cerrar(req.params.id, req.user));

  app.get('/ws/claude/:id', { websocket: true, config: { requires: 'module:claude' } }, (socket, req) => {
    if (!originAllowed(req, cfg)) {
      socket.close(1008, 'Origen no permitido');
      return;
    }
    const { id } = req.params;
    try {
      claude.adjuntar(id, socket, Number(req.query.since ?? 0), req.user);
    } catch (err) {
      socket.close(1011, err.message || 'No se pudo adjuntar');
      return;
    }

    socket.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      try {
        if (msg.t === CLAUDE_WS.SEND) claude.enviar(id, String(msg.text ?? ''), req.user);
        else if (msg.t === CLAUDE_WS.INTERRUPT) await claude.interrumpir(id, req.user);
        else if (msg.t === CLAUDE_WS.DECIDE) claude.decidir(id, msg.id, msg.decision || {}, req.user);
        else if (msg.t === CLAUDE_WS.SET) await claude.ajustar(id, msg.settings || {}, req.user);
      } catch (err) {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ t: CLAUDE_WS.ERROR, message: err.message }));
        }
      }
    });

    // Cerrar el socket NO termina la conversación: igual que con el PTY, el
    // proceso sigue y al volver se reproduce lo que pasó mientras tanto.
    socket.on('close', () => claude.desadjuntar(id, socket));
    socket.on('error', () => claude.desadjuntar(id, socket));
  });
}
