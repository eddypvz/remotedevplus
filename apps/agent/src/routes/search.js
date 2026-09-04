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
}
