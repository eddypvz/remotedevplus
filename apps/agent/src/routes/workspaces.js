export default async function workspaceRoutes(app, { workspaces, guard, hosts }) {
  const R = { config: { requires: 'fs:read' } };

  app.get('/api/workspaces', R, async (req) => ({
    workspaces: await workspaces.list(req.user),
    // Las raíces se mandan aparte: es de dónde puede elegir carpetas el editor
    // de workspaces, y el límite duro de lo que el agente le deja ver.
    roots: await guard.visibleRoots(req.user),
    hosts: hosts.list(),
  }));

  app.post('/api/workspaces', R, async (req) => (
    workspaces.create(req.user, req.body || {})
  ));

  /**
   * Valida una ruta suelta antes de agregarla a un workspace, para que el
   * editor pueda advertir "esa carpeta está fuera de sus raíces" mientras se
   * escribe, en vez de fallar recién al guardar.
   */
  app.get('/api/workspaces/check', { config: { requires: 'fs:read' } }, async (req) => {
    try {
      const r = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
      const st = await hosts.get(r.host).stat(r.path);
      if (st?.kind !== 'dir') return { ok: false, reason: 'No es un directorio' };
      return { ok: true, path: r.path, root: r.root.name };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  app.get('/api/workspaces/:id', R, async (req) => (
    workspaces.get(req.user, Number(req.params.id))
  ));

  app.patch('/api/workspaces/:id', R, async (req) => (
    workspaces.update(req.user, Number(req.params.id), req.body || {})
  ));

  app.post('/api/workspaces/:id/open', R, async (req) => (
    workspaces.open(req.user, Number(req.params.id))
  ));

  app.delete('/api/workspaces/:id', R, async (req) => (
    workspaces.remove(req.user, Number(req.params.id))
  ));

}
