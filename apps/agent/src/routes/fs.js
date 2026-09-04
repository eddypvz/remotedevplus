export default async function fsRoutes(app, { hosts, guard, audit }) {
  app.get('/api/fs/roots', { config: { requires: 'fs:read' } }, async (req) => ({
    roots: await guard.visibleRoots(req.user),
    hosts: hosts.list(),
  }));

  app.get('/api/fs/list', { config: { requires: 'fs:read' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
    const host = hosts.get(root.host);
    const st = await host.stat(path);
    if (st?.kind !== 'dir') {
      const err = new Error('No es un directorio');
      err.statusCode = 400;
      throw err;
    }
    return { path, entries: await host.list(path) };
  });

  app.get('/api/fs/read', { config: { requires: 'fs:read' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
    const host = hosts.get(root.host);
    const file = await host.readFile(path);
    return { path, ...file };
  });

  app.put('/api/fs/write', { config: { requires: 'fs:write' } }, async (req) => {
    const { path: raw, content } = req.body || {};
    const { path, root } = await guard.resolvePath(req.user, raw);
    if (typeof content !== 'string') {
      const err = new Error('Falta el contenido');
      err.statusCode = 400;
      throw err;
    }
    await hosts.get(root.host).writeFile(path, content);
    audit.log(req.user.id, 'fs.write', { path, bytes: Buffer.byteLength(content) }, req.ip);
    return { path, bytes: Buffer.byteLength(content) };
  });

  app.post('/api/fs/mkdir', { config: { requires: 'fs:write' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.body?.path);
    await hosts.get(root.host).mkdir(path);
    audit.log(req.user.id, 'fs.mkdir', { path }, req.ip);
    return { path };
  });

  app.post('/api/fs/rename', { config: { requires: 'fs:write' } }, async (req) => {
    const from = await guard.resolvePath(req.user, req.body?.from, { mustExist: true });
    const to = await guard.resolvePath(req.user, req.body?.to);
    await hosts.get(from.root.host).rename(from.path, to.path);
    audit.log(req.user.id, 'fs.rename', { from: from.path, to: to.path }, req.ip);
    return { from: from.path, to: to.path };
  });

  app.post('/api/fs/remove', { config: { requires: 'fs:write' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.body?.path, { mustExist: true });
    await hosts.get(root.host).remove(path, !!req.body?.recursive);
    audit.log(req.user.id, 'fs.remove', { path, recursive: !!req.body?.recursive }, req.ip);
    return { path };
  });
}
