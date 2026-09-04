import { basename } from 'node:path';
import { ROLES, isValidPermission, ALL, hasPermission } from '@remotedevplus/protocol';
import { plain } from '../db/index.js';
import { httpError, resolveUnchecked } from '../paths.js';
import { hashPassword } from './auth.js';

export function createUsers(db, audit, guard) {
  const q = {
    insert: db.prepare('INSERT INTO users (username, display_name, permissions, roots, created_at) VALUES (?, ?, ?, ?, ?)'),
    insertCred: db.prepare("INSERT INTO credentials (user_id, type, secret, created_at) VALUES (?, 'password', ?, ?)"),
    updateCred: db.prepare("UPDATE credentials SET secret = ?, created_at = ? WHERE user_id = ? AND type = 'password'"),
    hasCred: db.prepare("SELECT id FROM credentials WHERE user_id = ? AND type = 'password'"),
    all: db.prepare('SELECT * FROM users ORDER BY username'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    byName: db.prepare('SELECT * FROM users WHERE username = ?'),
    setPerms: db.prepare('UPDATE users SET permissions = ? WHERE id = ?'),
    setRoots: db.prepare('UPDATE users SET roots = ? WHERE id = ?'),
    setDisabled: db.prepare('UPDATE users SET disabled = ? WHERE id = ?'),
    setName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM users WHERE id = ?'),
    countAdmins: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE disabled = 0 AND permissions LIKE '%"*"%'`),
  };

  function shape(row) {
    const u = plain(row);
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      permissions: JSON.parse(u.permissions),
      roots: u.roots ? JSON.parse(u.roots) : null,
      disabled: !!u.disabled,
      createdAt: u.created_at,
      hasPassword: !!q.hasCred.get(u.id),
    };
  }

  /**
   * Tampoco se pueden otorgar permisos que uno no tiene: si no, un
   * `users:manage` se convertiría en super admin creando otro usuario y
   * entrando con él.
   */
  function grantablePermissions(actor, perms) {
    if (hasPermission(actor?.permissions, ALL)) return perms;
    const missing = perms.filter((p) => !hasPermission(actor?.permissions, p));
    if (missing.length) {
      throw httpError(403, `No puede otorgar permisos que no posee: ${missing.join(', ')}`);
    }
    return perms;
  }

  function normalizePermissions(input) {
    const list = Array.isArray(input) ? input : [];
    // Un nombre de rol se expande a su paquete; lo demás debe ser un permiso real.
    const out = new Set();
    for (const item of list) {
      if (ROLES[item]) ROLES[item].forEach((p) => out.add(p));
      else if (isValidPermission(item)) out.add(item);
      else throw httpError(400, `Permiso desconocido: ${item}`);
    }
    // Con '*' lo demás es ruido.
    return out.has(ALL) ? [ALL] : [...out];
  }

  /**
   * Guardarraíl de escalada de privilegios.
   *
   * Con raíces como rutas libres, alguien con `users:manage` podría darse a sí
   * mismo /etc — o dárselo a un cómplice — y saltarse la frontera entera. La
   * regla: **solo se pueden otorgar raíces que caigan dentro de las propias.** El
   * super admin es la excepción, porque su límite ya es la máquina.
   */
  async function grantableRoots(actor, input) {
    if (input === null || input === undefined) return null;
    if (!Array.isArray(input)) throw httpError(400, 'Las raíces son una lista');
    if (!input.length) return null;   // vacío = hereda las del agente
    if (input.length > 16) throw httpError(400, 'Máximo 16 raíces por usuario');

    const superAdmin = hasPermission(actor?.permissions, ALL);
    const out = [];
    const seen = new Set();
    for (const item of input) {
      const raw = typeof item === 'string' ? item : item?.path;
      const path = superAdmin
        ? await resolveUnchecked(raw)
        // Para el resto, resolvePath ya rechaza con 403 lo que caiga fuera.
        : (await guard.resolvePath(actor, raw, { mustExist: true })).path;
      if (seen.has(path)) continue;
      seen.add(path);
      // basename('/') es vacío, y una raíz sin nombre se ve mal en el explorador.
      const label = (typeof item === 'object' && item?.name) || basename(path) || 'disco';
      out.push({ name: String(label).slice(0, 40), path, host: 'local' });
    }
    return out;
  }

  /** No se puede quedar sin ningún super admin habilitado. */
  function guardLastAdmin(userId, { permissions, disabled }) {
    const current = shape(q.byId.get(userId));
    if (!current) throw httpError(404, 'No existe el usuario');
    const wasAdmin = current.permissions.includes(ALL) && !current.disabled;
    if (!wasAdmin) return;
    const stillAdmin = (permissions ? permissions.includes(ALL) : current.permissions.includes(ALL))
      && !(disabled ?? current.disabled);
    if (!stillAdmin && q.countAdmins.get().n <= 1) {
      throw httpError(409, 'Es el único super admin habilitado; quedarías fuera del sistema');
    }
  }

  return {
    async create({ username, password, displayName, permissions, roots }, actor = null) {
      const actorId = actor?.id ?? null;
      if (!/^[a-z0-9_.-]{2,32}$/i.test(username || '')) {
        throw httpError(400, 'Usuario inválido: 2-32 caracteres, letras, números, . _ -');
      }
      if (!password || password.length < 8) {
        throw httpError(400, 'La contraseña necesita al menos 8 caracteres');
      }
      if (q.byName.get(username)) throw httpError(409, 'Ese usuario ya existe');

      const perms = grantablePermissions(actor, normalizePermissions(permissions?.length ? permissions : ['dev']));
      const checked = await grantableRoots(actor, roots);
      const info = q.insert.run(username, displayName || null, JSON.stringify(perms),
        checked ? JSON.stringify(checked) : null, Date.now());
      const id = Number(info.lastInsertRowid);
      q.insertCred.run(id, await hashPassword(password), Date.now());
      audit.log(actorId, 'user.create', { username, permissions: perms, roots: checked });
      return shape(q.byId.get(id));
    },

    list() { return q.all.all().map(shape); },
    get(id) { return shape(q.byId.get(id)); },
    getByName(name) { return shape(q.byName.get(name)); },

    async setPassword(id, password, actor = null) {
      const actorId = actor?.id ?? null;
      if (!password || password.length < 8) {
        throw httpError(400, 'La contraseña necesita al menos 8 caracteres');
      }
      if (!q.byId.get(id)) throw httpError(404, 'No existe el usuario');
      const secret = await hashPassword(password);
      if (q.hasCred.get(id)) q.updateCred.run(secret, Date.now(), id);
      else q.insertCred.run(id, secret, Date.now());
      audit.log(actorId, 'user.password', { id });
      return shape(q.byId.get(id));
    },

    setPermissions(id, permissions, actor = null) {
      const actorId = actor?.id ?? null;
      const perms = grantablePermissions(actor, normalizePermissions(permissions));
      guardLastAdmin(id, { permissions: perms });
      q.setPerms.run(JSON.stringify(perms), id);
      audit.log(actorId, 'user.permissions', { id, permissions: perms });
      return shape(q.byId.get(id));
    },

    async setRoots(id, roots, actor = null) {
      if (!q.byId.get(id)) throw httpError(404, 'No existe el usuario');
      const checked = await grantableRoots(actor, roots);
      q.setRoots.run(checked ? JSON.stringify(checked) : null, id);
      audit.log(actor?.id ?? null, 'user.roots', { id, roots: checked });
      return shape(q.byId.get(id));
    },

    setDisabled(id, disabled, actor = null) {
      const actorId = actor?.id ?? null;
      guardLastAdmin(id, { disabled: !!disabled });
      q.setDisabled.run(disabled ? 1 : 0, id);
      audit.log(actorId, disabled ? 'user.disable' : 'user.enable', { id });
      return shape(q.byId.get(id));
    },

    setDisplayName(id, name, actor = null) {
      const actorId = actor?.id ?? null;
      if (!q.byId.get(id)) throw httpError(404, 'No existe el usuario');
      q.setName.run(name || null, id);
      return shape(q.byId.get(id));
    },

    remove(id, actor = null) {
      const actorId = actor?.id ?? null;
      guardLastAdmin(id, { disabled: true });
      const u = shape(q.byId.get(id));
      if (!u) throw httpError(404, 'No existe el usuario');
      q.remove.run(id);
      audit.log(actorId, 'user.remove', { id, username: u.username });
      return u;
    },
  };
}
