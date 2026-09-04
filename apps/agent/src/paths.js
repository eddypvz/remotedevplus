import { realpath, stat } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import { hasPermission, ALL } from '@remotedevplus/protocol';

/**
 * Frontera de seguridad del sistema.
 *
 * Toda ruta que llega por la API pasa por acá. Se resuelve con realpath y se
 * compara contra las raíces configuradas, intersectadas con las del usuario.
 * Un symlink que apunta fuera de una raíz queda fuera, porque realpath lo
 * delata antes de la comparación.
 */

/** `/var/www` no debe hacer match con `/var/wwwmalo`. */
function isInside(p, root) {
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Las raíces de un usuario. Tres formas, en orden histórico:
 *
 *  - `null` o vacío  → hereda las raíces con las que arrancó el agente.
 *  - `['www', ...]`  → LEGADO: nombres que filtran las del agente. Se sigue
 *                      soportando para no romper bases viejas.
 *  - `[{name, path}]`→ rutas propias del usuario. Es la forma actual: cada dev
 *                      tiene su carpeta (/var/juan) sin depender de que exista
 *                      una raíz global que la contenga.
 *
 * Un super admin con `[{name:'disco', path:'/'}]` ve todo, que es coherente:
 * con terminal ya podía leer todo el disco de todos modos.
 */
export function userRoots(cfg, user) {
  const own = user?.roots;
  if (!own || !own.length) return cfg.roots;
  if (typeof own[0] === 'string') {
    return cfg.roots.filter((r) => own.includes(r.name));
  }
  return own.map((r) => ({ name: r.name, path: r.path, host: r.host || 'local' }));
}

export function createPathGuard(cfg) {
  /** realpath cacheado: las raíces no se mueven durante la vida del proceso. */
  const resolved = new Map();

  async function rootsFor(user) {
    const out = [];
    for (const r of userRoots(cfg, user)) {
      if (!resolved.has(r.path)) {
        resolved.set(r.path, await realpath(r.path).catch(() => resolve(r.path)));
      }
      out.push({ ...r, real: resolved.get(r.path) });
    }
    return out;
  }

  /** Las raíces tal como las ve este usuario, para el explorador. */
  async function visibleRoots(user) {
    return (await rootsFor(user)).map(({ name, path, host }) => ({ name, path, host }));
  }

  /**
   * @param {object} user
   * @param {string} requested ruta absoluta pedida por el cliente
   * @param {{ mustExist?: boolean }} [opts] si no debe existir todavía (crear
   *   un archivo), se valida el directorio padre.
   */
  async function resolvePath(user, requested, opts = {}) {
    if (typeof requested !== 'string' || !requested) {
      throw httpError(400, 'Falta la ruta');
    }
    const abs = resolve(requested);
    const roots = await rootsFor(user);
    if (!roots.length) throw httpError(403, 'Este usuario no tiene raíces asignadas');

    // Si el destino no existe todavía, el ancla es el padre más cercano que sí.
    let anchor = abs;
    let real;
    for (;;) {
      try { real = await realpath(anchor); break; }
      catch (err) {
        if (err.code !== 'ENOENT' || opts.mustExist) throw httpError(404, 'No existe la ruta');
        const parent = dirname(anchor);
        if (parent === anchor) throw httpError(404, 'No existe la ruta');
        anchor = parent;
      }
    }
    // La parte que aún no existe se vuelve a pegar sobre el ancla real.
    const tail = abs.slice(anchor.length);
    const target = real + tail;

    const root = roots.find((r) => isInside(target, r.real));
    if (!root) throw httpError(403, 'Ruta fuera de las raíces permitidas');
    return { path: target, root, host: root.host };
  }

  return { resolvePath, visibleRoots };
}

/**
 * Resuelve una ruta sin validarla contra ninguna raíz. Es deliberadamente
 * peligroso y tiene UN solo uso legítimo: un super admin asignándole raíces a
 * un usuario. Cualquier otra ruta del sistema debe pasar por resolvePath.
 */
export async function resolveUnchecked(requested) {
  if (typeof requested !== 'string' || !requested.trim()) {
    throw httpError(400, 'Falta la ruta');
  }
  let real;
  try {
    real = await realpath(resolve(requested));
  } catch {
    throw httpError(404, `No existe la ruta ${requested}`);
  }
  const st = await stat(real);
  if (!st.isDirectory()) throw httpError(400, `${requested} no es un directorio`);
  return real;
}

export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export function requirePermission(user, needed) {
  if (!hasPermission(user?.permissions, needed)) {
    throw httpError(403, `Falta el permiso ${needed}`);
  }
}

export { hasPermission, ALL };
