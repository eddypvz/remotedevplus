export default async function userRoutes(app, { users, auth, audit }) {
  const R = { config: { requires: 'users:manage' } };

  app.get('/api/users', R, async () => ({ users: users.list() }));

  app.post('/api/users', R, async (req) => (
    users.create(req.body || {}, req.user)
  ));

  app.patch('/api/users/:id', R, async (req) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    let out = users.get(id);
    if (!out) {
      const err = new Error('No existe el usuario');
      err.statusCode = 404;
      throw err;
    }
    if (b.password !== undefined) out = await users.setPassword(id, b.password, req.user);
    if (b.permissions !== undefined) out = users.setPermissions(id, b.permissions, req.user);
    if (b.roots !== undefined) out = await users.setRoots(id, b.roots, req.user);
    if (b.displayName !== undefined) out = users.setDisplayName(id, b.displayName, req.user);
    if (b.disabled !== undefined) {
      out = users.setDisabled(id, b.disabled, req.user);
      // Desactivar sin revocar sesiones no desactiva nada: el que ya estaba
      // dentro seguiría dentro hasta que expire su cookie.
      if (b.disabled) auth.logoutAll(id);
    }
    return out;
  });

  app.delete('/api/users/:id', R, async (req) => {
    const id = Number(req.params.id);
    const removed = users.remove(id, req.user);
    auth.logoutAll(id);
    return removed;
  });

  app.get('/api/audit', { config: { requires: 'audit:read' } }, async (req) => ({
    entries: audit.recent(Math.min(Number(req.query.limit) || 200, 1000)),
  }));
}
