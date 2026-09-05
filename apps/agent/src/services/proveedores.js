import { httpError } from '../paths.js';
import { plain } from '../db/index.js';

/**
 * Credenciales de proveedores de git, para listar repositorios.
 *
 * Hace falta un token porque **la llave SSH no sirve para esto**: autentica un
 * `git clone` y nada más; la API de GitHub no la mira. Sin token se puede
 * clonar pegando la URL, que es el camino que siempre funciona; el listado es
 * lo que necesita credenciales.
 *
 * El token se guarda **en claro** en la base, por usuario. Eso hay que decirlo
 * y no esconderlo: quien pueda leer el archivo de la base puede usarlo. No hay
 * un almacén de secretos en el que apoyarse —cifrarlo con una clave que vive al
 * lado sería teatro— así que lo honesto es pedir uno de solo lectura y ofrecer
 * quitarlo.
 */

/** Un token de GitHub tiene prefijo conocido; se rechaza lo que claramente no lo es. */
const FORMATO_GITHUB = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

/** Lo máximo que devuelve GitHub por página. */
const POR_PAGINA = 100;
/**
 * Tope de páginas.
 *
 * Diez son mil repositorios. Es un techo para no quedar en un bucle contra una
 * cuenta enorme, no una cifra que se espere alcanzar: si se alcanza, se avisa.
 */
const PAGINAS_MAX = 10;

export function createProveedores(db, audit) {
  const q = {
    guardar: db.prepare(`INSERT INTO git_tokens (user_id, proveedor, token, login, saved_at)
                         VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(user_id, proveedor) DO UPDATE
                         SET token = excluded.token, login = excluded.login, saved_at = excluded.saved_at`),
    leer: db.prepare('SELECT token, login, saved_at FROM git_tokens WHERE user_id = ? AND proveedor = ?'),
    borrar: db.prepare('DELETE FROM git_tokens WHERE user_id = ? AND proveedor = ?'),
  };

  async function pedirAGitHub(token, ruta) {
    const res = await fetch(`https://api.github.com${ruta}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'remotedevplus',
        'x-github-api-version': '2022-11-28',
      },
      // Sin esto una API caída deja la petición colgada hasta que el navegador
      // se rinda, sin decir nada.
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) throw httpError(401, 'GitHub rechazó el token. Puede haber caducado o haber sido revocado.');
    if (res.status === 403) throw httpError(403, 'GitHub rechazó la petición: token sin permisos suficientes, o límite de peticiones alcanzado.');
    if (!res.ok) throw httpError(502, `GitHub respondió ${res.status}`);
    return res.json();
  }

  return {
    /** Qué hay guardado, sin devolver nunca el token. */
    estado(user) {
      const fila = plain(q.leer.get(user.id, 'github'));
      return { configurado: !!fila, login: fila?.login ?? null, desde: fila?.saved_at ?? null };
    },

    /**
     * Guarda el token después de comprobarlo contra GitHub.
     *
     * Se verifica antes de guardar para no dejar uno inservible que después
     * falle en el momento menos útil, y de paso se aprende el login: así el
     * listado puede decir de quién son los repositorios.
     */
    async guardar(user, token) {
      const limpio = String(token ?? '').trim();
      if (!FORMATO_GITHUB.test(limpio)) {
        throw httpError(400, 'Eso no parece un token de GitHub. Empiezan por ghp_, gho_, ghu_, ghs_, ghr_ o github_pat_.');
      }
      const yo = await pedirAGitHub(limpio, '/user');
      q.guardar.run(user.id, 'github', limpio, yo.login ?? null, Date.now());
      audit.log(user.id, 'git.token.save', { proveedor: 'github', login: yo.login });
      return { configurado: true, login: yo.login ?? null };
    },

    borrar(user) {
      q.borrar.run(user.id, 'github');
      audit.log(user.id, 'git.token.delete', { proveedor: 'github' });
      return { configurado: false, login: null };
    },

    /**
     * Los repositorios a los que el usuario tiene acceso.
     *
     * `affiliation` incluye los de organizaciones y aquellos donde es
     * colaborador, no solo los propios: "a los que tengo acceso" es eso.
     * Ordenados por actividad, que es como se busca uno.
     */
    async repositorios(user, { buscar = '', paginasMax = PAGINAS_MAX } = {}) {
      const fila = plain(q.leer.get(user.id, 'github'));
      if (!fila) {
        throw httpError(412, 'Falta el token de GitHub. Se puede clonar pegando la URL sin configurar nada.');
      }

      /*
       * Se pagina hasta agotar, no hasta un número redondo.
       *
       * El primer intento traía una sola página de 100 y se quedaba ahí: con
       * 202 repositorios escondía la mitad, incluidos dos dueños enteros, y sin
       * decirlo. Un tope sigue haciendo falta para no quedar en un bucle si la
       * cuenta tiene miles, pero cuando se alcanza se avisa.
       */
      const todos = [];
      let truncado = false;
      for (let p = 1; p <= paginasMax; p++) {
        const lote = await pedirAGitHub(
          fila.token,
          `/user/repos?per_page=${POR_PAGINA}&page=${p}&sort=pushed&affiliation=owner,collaborator,organization_member`,
        );
        todos.push(...lote);
        if (lote.length < POR_PAGINA) break;
        if (p === paginasMax) truncado = true;
      }

      const t = buscar.trim().toLowerCase();
      const repos = todos
        .filter((r) => !t || r.full_name.toLowerCase().includes(t) || (r.description ?? '').toLowerCase().includes(t))
        .map((r) => ({
          nombre: r.name,
          completo: r.full_name,
          descripcion: r.description ?? '',
          privado: !!r.private,
          // Se ofrece SSH: es lo que la llave del servidor puede usar sin pedir
          // credenciales. La de HTTPS queda por si alguien la prefiere.
          ssh: r.ssh_url,
          https: r.clone_url,
          rama: r.default_branch,
          actualizado: new Date(r.pushed_at ?? r.updated_at ?? Date.now()).getTime(),
        }))
        .sort((a, b) => b.actualizado - a.actualizado);

      return { repos, total: todos.length, truncado };
    },
  };
}
