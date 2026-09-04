import { basename } from 'node:path';
import { plain } from '../db/index.js';
import { httpError } from '../paths.js';

const MAX_FOLDERS = 24;

/**
 * Workspaces: conjuntos de carpetas con nombre, por usuario.
 *
 * Un workspace **no otorga acceso, lo recorta**. La frontera de seguridad
 * sigue siendo la lista de raíces del agente: cada carpeta se valida contra
 * ella al guardar y OTRA VEZ al leer. Lo segundo no es paranoia — si un admin
 * le restringe las raíces a un usuario después, sus workspaces viejos tienen
 * que dejar de mostrar lo que ya no le corresponde.
 */
export function createWorkspaces(db, guard, audit) {
  const q = {
    listFor: db.prepare('SELECT * FROM workspaces WHERE user_id = ? ORDER BY opened_at DESC, name'),
    byId: db.prepare('SELECT * FROM workspaces WHERE id = ? AND user_id = ?'),
    byName: db.prepare('SELECT * FROM workspaces WHERE user_id = ? AND name = ?'),
    insert: db.prepare('INSERT INTO workspaces (user_id, name, folders, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE workspaces SET name = ?, folders = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    touch: db.prepare('UPDATE workspaces SET opened_at = ? WHERE id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?'),
  };

  function shape(row) {
    const w = plain(row);
    if (!w) return null;
    return {
      id: w.id,
      name: w.name,
      folders: JSON.parse(w.folders),
      createdAt: w.created_at,
      updatedAt: w.updated_at,
      openedAt: w.opened_at,
    };
  }

  /** Valida y normaliza las carpetas contra las raíces visibles del usuario. */
  async function checkFolders(user, input) {
    if (!Array.isArray(input) || !input.length) {
      throw httpError(400, 'Un workspace necesita al menos una carpeta');
    }
    if (input.length > MAX_FOLDERS) {
      throw httpError(400, `Máximo ${MAX_FOLDERS} carpetas por workspace`);
    }
    const out = [];
    const seen = new Set();
    for (const raw of input) {
      const path = typeof raw === 'string' ? raw : raw?.path;
      // resolvePath tira 403 si cae fuera de las raíces del usuario, y 404 si
      // no existe. Las dos son respuestas correctas acá.
      const resolved = await guard.resolvePath(user, path, { mustExist: true });
      if (seen.has(resolved.path)) continue;
      seen.add(resolved.path);
      const label = (typeof raw === 'object' && raw?.name) || basename(resolved.path) || resolved.path;
      out.push({ name: String(label).slice(0, 60), path: resolved.path, host: resolved.host });
    }
    return out;
  }

  /**
   * Al leer se vuelven a filtrar las carpetas: las que ya no caen dentro de una
   * raíz permitida se marcan y no se muestran en el explorador.
   */
  async function withAccess(user, ws) {
    const folders = [];
    let dropped = 0;
    for (const f of ws.folders) {
      try {
        await guard.resolvePath(user, f.path, { mustExist: true });
        folders.push(f);
      } catch {
        dropped++;
      }
    }
    return { ...ws, folders, unavailable: dropped };
  }

  return {
    async list(user) {
      const rows = q.listFor.all(user.id).map(shape);
      return Promise.all(rows.map((w) => withAccess(user, w)));
    },

    async get(user, id) {
      const ws = shape(q.byId.get(id, user.id));
      if (!ws) throw httpError(404, 'No existe ese workspace');
      return withAccess(user, ws);
    },

    async create(user, { name, folders }) {
      const label = String(name || '').trim();
      if (label.length < 1 || label.length > 60) {
        throw httpError(400, 'El nombre del workspace va de 1 a 60 caracteres');
      }
      if (q.byName.get(user.id, label)) throw httpError(409, 'Ya existe un workspace con ese nombre');
      const checked = await checkFolders(user, folders);
      const now = Date.now();
      const info = q.insert.run(user.id, label, JSON.stringify(checked), now, now);
      audit.log(user.id, 'workspace.create', { name: label, folders: checked.map((f) => f.path) });
      return this.get(user, Number(info.lastInsertRowid));
    },

    async update(user, id, { name, folders }) {
      const current = shape(q.byId.get(id, user.id));
      if (!current) throw httpError(404, 'No existe ese workspace');
      const label = name === undefined ? current.name : String(name).trim();
      if (!label) throw httpError(400, 'El workspace necesita un nombre');
      const clash = q.byName.get(user.id, label);
      if (clash && clash.id !== id) throw httpError(409, 'Ya existe un workspace con ese nombre');
      const checked = folders === undefined ? current.folders : await checkFolders(user, folders);
      q.update.run(label, JSON.stringify(checked), Date.now(), id, user.id);
      audit.log(user.id, 'workspace.update', { id, name: label });
      return this.get(user, id);
    },

    async open(user, id) {
      // El touch va antes del get: si no, la respuesta devuelve el openedAt
      // viejo y el cliente ordena mal la lista de recientes.
      if (!q.byId.get(id, user.id)) throw httpError(404, 'No existe ese workspace');
      q.touch.run(Date.now(), id, user.id);
      return this.get(user, id);
    },

    remove(user, id) {
      const ws = shape(q.byId.get(id, user.id));
      if (!ws) throw httpError(404, 'No existe ese workspace');
      q.remove.run(id, user.id);
      audit.log(user.id, 'workspace.remove', { id, name: ws.name });
      return { id };
    },
  };
}
