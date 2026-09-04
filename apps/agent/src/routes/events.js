import { originAllowed } from './pty.js';

/**
 * `/ws/events` — el canal que el agente empuja.
 *
 * El cliente dice qué directorios tiene a la vista (`watch`) y el agente le
 * avisa cuando cambian. No hay polling: una tablet no puede estar preguntando
 * cada segundo por veinte carpetas.
 */
export default async function eventRoutes(app, { events, cfg }) {
  app.get('/ws/events', { websocket: true, config: { requires: 'fs:read' } }, (socket, req) => {
    // Mismo motivo que en `/ws/pty`: el upgrade de WebSocket no está sujeto a
    // la política de same-origin, así que la cookie sola no alcanza.
    if (!originAllowed(req, cfg)) {
      socket.close(1008, 'Origen no permitido');
      return;
    }

    const conn = events.connect(socket, req.user);

    socket.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t === 'watch') conn.watch(msg.paths);
      else if (msg.t === 'unwatch') conn.unwatch(msg.paths);
      else if (msg.t === 'watch-git') conn.watchGit(msg.paths);
      else if (msg.t === 'unwatch-git') conn.unwatchGit(msg.paths);
    });

    socket.on('close', () => conn.close());
    socket.on('error', () => conn.close());
  });
}
