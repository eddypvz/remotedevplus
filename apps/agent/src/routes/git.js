import { hasPermission } from '../paths.js';

export default async function gitRoutes(app, { git, proveedores }) {
  const L = { config: { requires: 'git:read' } };
  const W = { config: { requires: 'git:write' } };
  const cwd = (req) => req.query.cwd ?? req.body?.cwd;

  app.get('/api/git/status', L, async (req) => git.estado(req.user, cwd(req)));
  app.get('/api/git/graph', L, async (req) => git.grafo(req.user, cwd(req), Number(req.query.limit) || 200));
  app.get('/api/git/branches', L, async (req) => git.ramas(req.user, cwd(req)));
  app.get('/api/git/stash', L, async (req) => git.stash(req.user, cwd(req)));
  app.get('/api/git/diff', L, async (req) => (
    git.diff(req.user, cwd(req), req.query.path, req.query.staged === '1')
  ));
  app.get('/api/git/commit', L, async (req) => (
    git.detalleCommit(req.user, cwd(req), req.query.hash)
  ));
  app.get('/api/git/commit/diff', L, async (req) => (
    git.diffCommit(req.user, cwd(req), req.query.hash, req.query.path)
  ));

  app.post('/api/git/stage', W, async (req) => (
    git.preparar(req.user, cwd(req), req.body?.paths, false)
  ));
  app.post('/api/git/unstage', W, async (req) => (
    git.preparar(req.user, cwd(req), req.body?.paths, true)
  ));
  app.post('/api/git/discard', W, async (req) => (
    git.descartar(req.user, cwd(req), req.body?.paths)
  ));
  /*
   * Clonar y el listado de repositorios.
   *
   * `git:write` no alcanza para clonar: crea una carpeta nueva en el disco, así
   * que también hace falta `fs:write`. Se comprueba adentro porque el hook
   * global solo verifica un permiso por ruta.
   */
  app.post('/api/git/clone', W, async (req) => {
    if (!hasPermission(req.user.permissions, 'fs:write')) {
      const err = new Error('Falta el permiso fs:write');
      err.statusCode = 403;
      throw err;
    }
    return git.clonar(req.user, {
      url: req.body?.url, dir: req.body?.dir, nombre: req.body?.name,
    });
  });

  // El token es por usuario y nunca se devuelve: solo si está y de quién es.
  app.get('/api/git/provider', L, async (req) => proveedores.estado(req.user));
  app.put('/api/git/provider', W, async (req) => proveedores.guardar(req.user, req.body?.token));
  app.delete('/api/git/provider', W, async (req) => proveedores.borrar(req.user));

  app.get('/api/git/repos', L, async (req) => (
    proveedores.repositorios(req.user, { buscar: req.query.q ?? '' })
  ));

  app.post('/api/git/resolve', W, async (req) => (
    git.resolver(req.user, cwd(req), req.body?.paths, req.body?.side)
  ));
  app.post('/api/git/sequencer', W, async (req) => (
    git.seguir(req.user, cwd(req), req.body?.action)
  ));

  app.post('/api/git/commit', W, async (req) => (
    git.commit(req.user, cwd(req), req.body?.message, {
      enmendar: !!req.body?.amend, todo: !!req.body?.all,
    })
  ));

  app.post('/api/git/stash', W, async (req) => (
    git.guardarStash(req.user, cwd(req), req.body?.message, req.body?.untracked !== false)
  ));
  app.post('/api/git/stash/apply', W, async (req) => (
    git.aplicarStash(req.user, cwd(req), req.body?.ref, !!req.body?.pop)
  ));
  app.delete('/api/git/stash', W, async (req) => (
    git.borrarStash(req.user, cwd(req), req.body?.ref)
  ));

  app.post('/api/git/fetch', W, async (req) => git.traer(req.user, cwd(req)));
  app.post('/api/git/pull', W, async (req) => (
    git.bajar(req.user, cwd(req), { rebase: !!req.body?.rebase })
  ));
  app.post('/api/git/push', W, async (req) => (
    git.subir(req.user, cwd(req), { forzar: !!req.body?.force, remoto: req.body?.remote })
  ));
  app.post('/api/git/rebase', W, async (req) => (
    git.reordenar(req.user, cwd(req), req.body?.onto)
  ));
  app.post('/api/git/checkout', W, async (req) => (
    git.situarse(req.user, cwd(req), req.body?.ref)
  ));

  app.post('/api/git/switch', W, async (req) => (
    git.cambiarRama(req.user, cwd(req), req.body?.name, !!req.body?.create)
  ));
}
