import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { plain } from '../db/index.js';
import { httpError } from '../paths.js';

const scryptAsync = promisify(scrypt);

// scrypt de node:crypto en vez de argon2: mismo orden de dureza y **sin módulo
// nativo**, coherente con que el proyecto se clone y corra sin build tools.
// N=2^15 mide ~64ms en el server de referencia.
// Ojo: hay que pasar maxmem explícito — el default de 32MB hace fallar N=2^15,
// porque necesita exactamente 128*N*r = 32MB.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    'scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64'), hash.toString('base64'),
  ].join('$');
}

export async function verifyPassword(stored, password) {
  const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function createAuth(db, cfg, audit) {
  const ttlMs = cfg.sessionTtlDays * 86400_000;

  // Se precalienta el hash señuelo al arrancar. Si se generara en el primer
  // login de un usuario inexistente, ese request pagaría dos scrypt en vez de
  // uno y el tiempo delataría que el usuario no existe.
  dummyHash();

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    passwordFor: db.prepare("SELECT * FROM credentials WHERE user_id = ? AND type = 'password' LIMIT 1"),
    touchCredential: db.prepare('UPDATE credentials SET last_used_at = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    dropSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    dropUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    dropStale: db.prepare('DELETE FROM sessions WHERE last_seen < ?'),
    attempt: db.prepare('INSERT INTO login_attempts (username, ip, ok, at) VALUES (?, ?, ?, ?)'),
    recentFails: db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND at > ?'),
    anyUser: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0'),
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
    };
  }

  return {
    /** Sin usuarios habilitados el agente no sirve la app: hay que crear el primero. */
    hasUsers() { return q.anyUser.get().n > 0; },

    async login({ username, password, ip, userAgent }) {
      const addr = ip || 'unknown';
      const window = Date.now() - cfg.loginLockoutMinutes * 60_000;
      if (q.recentFails.get(addr, window).n >= cfg.loginMaxAttempts) {
        audit.log(null, 'login.lockout', { username }, addr);
        throw httpError(429, 'Demasiados intentos fallidos. Espera unos minutos.');
      }

      const user = shape(q.userByName.get(username || ''));
      const cred = user && !user.disabled ? plain(q.passwordFor.get(user.id)) : null;

      // Se verifica siempre, incluso cuando el usuario no existe: contra un hash
      // señuelo, para gastar el mismo tiempo y no revelar qué usuarios existen.
      const ok = cred
        ? await verifyPassword(cred.secret, password || '')
        : await verifyPassword(await dummyHash(), password || '');

      q.attempt.run(username || null, addr, ok ? 1 : 0, Date.now());
      if (!ok || !cred) {
        audit.log(user?.id ?? null, 'login.fail', { username }, addr);
        throw httpError(401, 'Usuario o contraseña incorrectos');
      }

      q.touchCredential.run(Date.now(), cred.id);
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      q.insertSession.run(sha256(token), user.id, now, now, addr, userAgent || null);
      audit.log(user.id, 'login.ok', null, addr);
      return { token, user };
    },

    /** Expiración deslizante: cada uso corre el vencimiento hacia adelante. */
    resolve(token) {
      if (!token) return null;
      const row = plain(q.session.get(sha256(token)));
      if (!row) return null;
      const now = Date.now();
      if (now - row.last_seen > ttlMs) {
        q.dropSession.run(row.token_hash);
        return null;
      }
      // Se toca como máximo cada minuto, para no escribir en cada request.
      if (now - row.last_seen > 60_000) q.touchSession.run(now, row.token_hash);
      const user = shape(q.userById.get(row.user_id));
      return user && !user.disabled ? user : null;
    },

    logout(token) { if (token) q.dropSession.run(sha256(token)); },
    logoutAll(userId) { q.dropUserSessions.run(userId); },
    sweep() { q.dropStale.run(Date.now() - ttlMs); },
  };
}

// Hash señuelo de una contraseña aleatoria que nadie conoce. Se genera una vez,
// en vez de ponerlo literal, para garantizar que sea un hash válido con los
// mismos parámetros que los reales — si no, el tiempo no coincidiría.
let dummyPromise = null;
function dummyHash() {
  dummyPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyPromise;
}
