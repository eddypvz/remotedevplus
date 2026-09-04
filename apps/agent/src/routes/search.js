import { hasPermission } from '../paths.js';

export default async function searchRoutes(app, { search }) {
  /**
   * Los resultados van como NDJSON en streaming.
   *
   * Un objeto por línea, escritos a medida que ripgrep los encuentra. El
   * cliente los va pintando; esperar la respuesta completa para mostrar la
   * primera coincidencia sería tirar el streaming a la basura.
   */
  app.post('/api/search', { config: { requires: 'module:search' } }, async (req, reply) => {
    const { cwds, ...opciones } = req.body || {};

    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Sin esto un proxy inverso puede acumular la respuesta y anular el streaming.
      'x-accel-buffering': 'no',
    });

    const escribir = (o) => {
      if (!reply.raw.destroyed) reply.raw.write(JSON.stringify(o) + '\n');
    };

    // Si el cliente corta —cambió lo que escribe—, se aborta el proceso.
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    try {
      const fin = await search.buscar(req.user, cwds, opciones, escribir, abort.signal);
      escribir({ t: 'fin', ...fin });
    } catch (err) {
      escribir({ t: 'error', mensaje: err.message });
    } finally {
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });

  /**
   * Reemplazo global. Pide `fs:write`: escribe archivos, no solo los lee.
   *
   * No va en streaming como la búsqueda porque no hay nada útil que mostrar a
   * medias: o el reemplazo se hizo o no, y el resumen llega en una respuesta.
   */
  app.post('/api/search/replace', { config: { requires: 'fs:write' } }, async (req) => {
    // Dos permisos: `fs:write` porque escribe, y `module:search` porque para
    // saber qué escribir hay que buscar. El hook global solo verifica uno.
    if (!hasPermission(req.user.permissions, 'module:search')) {
      const err = new Error('Falta el permiso module:search');
      err.statusCode = 403;
      throw err;
    }
    const { cwds, replacement, paths, ...opciones } = req.body || {};
    return search.reemplazar(req.user, cwds, opciones, replacement, paths);
  });
}
