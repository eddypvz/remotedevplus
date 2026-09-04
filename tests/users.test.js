import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, services, server, SUPER, PASS } from './helpers.js';

/**
 * Escalada de privilegios.
 *
 * Con raíces como rutas libres y permisos otorgables, alguien con
 * `users:manage` podría darse el disco entero o ascenderse a super admin. Estos
 * son los dos caminos, y los dos tienen que estar cerrados.
 */
describe('escalada de privilegios', () => {
  const sb = sandbox(['disco/var/www', 'disco/var/juan', 'disco/var/ana', 'disco/etc']);
  const svc = services(sb, { www: 'disco/var/www' });

  test('los guardarraíles aguantan', async () => {
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    // Un jefe de equipo: administra usuarios, pero solo ve /var/juan.
    await svc.users.create({
      username: 'jefe', password: PASS,
      permissions: ['module:file', 'fs:read', 'fs:write', 'users:manage'],
      roots: [{ name: 'juan', path: sb.at('disco/var/juan') }],
    }, SUPER);

    const { as, login } = await server(svc);
    await login('eddy');
    await login('jefe');

    // --- el super admin sí puede darse todo ---
    let r = await as('eddy', 'PATCH', '/api/users/1', { roots: [{ name: 'disco', path: sb.at('disco') }] });
    assert.equal(r.status, 200);
    r = await as('eddy', 'GET', `/api/fs/list?path=${encodeURIComponent(sb.at('disco/etc'))}`);
    assert.equal(r.status, 200, 'y su explorador lo refleja');

    // --- escalada por raíces ---
    r = await as('jefe', 'POST', '/api/users', {
      username: 'complice', password: PASS, permissions: ['module:file', 'fs:read'],
      roots: [{ path: sb.at('disco') }],
    });
    assert.equal(r.status, 403, 'no puede otorgar el disco entero');

    r = await as('jefe', 'PATCH', '/api/users/2', { roots: [{ path: sb.at('disco/etc') }] });
    assert.equal(r.status, 403, 'no puede darse /etc a sí mismo');

    r = await as('jefe', 'POST', '/api/users', {
      username: 'becario', password: PASS, permissions: ['module:file', 'fs:read'],
      roots: [{ path: sb.at('disco/var/juan') }],
    });
    assert.equal(r.status, 200, 'pero sí dentro de lo suyo');

    // --- escalada por permisos ---
    r = await as('jefe', 'POST', '/api/users', { username: 't1', password: PASS, permissions: ['admin'] });
    assert.equal(r.status, 403, 'no puede crear un super admin');

    r = await as('jefe', 'POST', '/api/users', { username: 't2', password: PASS, permissions: ['terminal:spawn'] });
    assert.equal(r.status, 403, 'no puede otorgar un permiso que no tiene');

    r = await as('jefe', 'PATCH', '/api/users/2', { permissions: ['admin'] });
    assert.equal(r.status, 403, 'no puede auto-ascenderse');

    // --- rutas inválidas ---
    r = await as('eddy', 'PATCH', '/api/users/1', { roots: [{ path: sb.at('no-existe') }] });
    assert.equal(r.status, 404);
    r = await as('eddy', 'PATCH', '/api/users/1', { roots: [{ path: '/etc/hostname' }] });
    assert.equal(r.status, 400, 'una raíz tiene que ser un directorio');
  });

  test('un dev solo ve su carpeta', async () => {
    const sb2 = sandbox(['var/www', 'var/juan']);
    const svc2 = services(sb2, { www: 'var/www' });
    await svc2.users.create({ username: 'admin', password: PASS, permissions: ['admin'] }, SUPER);
    await svc2.users.create({
      username: 'juan', password: PASS, permissions: ['dev'],
      roots: [{ path: sb2.at('var/juan') }],
    }, SUPER);

    const { as, login } = await server(svc2);
    await login('juan');

    const r = await as('juan', 'GET', '/api/fs/roots');
    assert.deepEqual(r.body.roots.map((x) => x.path), [sb2.at('var/juan')]);

    const fuera = await as('juan', 'GET', `/api/fs/list?path=${encodeURIComponent(sb2.at('var/www'))}`);
    assert.equal(fuera.status, 403);
    assert.equal((await as('juan', 'GET', '/api/users')).status, 403, 'sin users:manage');
  });
});

describe('reglas de usuarios', () => {
  const sb = sandbox(['www']);
  const svc = services(sb, { www: 'www' });

  test('no se puede quedar sin ningún super admin', async () => {
    const u = await svc.users.create({ username: 'solo', password: PASS, permissions: ['admin'] }, SUPER);
    assert.throws(() => svc.users.setPermissions(u.id, ['dev'], SUPER), (e) => e.statusCode === 409);
    assert.throws(() => svc.users.setDisabled(u.id, true, SUPER), (e) => e.statusCode === 409);
    assert.throws(() => svc.users.remove(u.id, SUPER), (e) => e.statusCode === 409);
  });

  test('valida nombre y contraseña', async () => {
    await assert.rejects(() => svc.users.create({ username: 'x', password: PASS }, SUPER), (e) => e.statusCode === 400);
    await assert.rejects(() => svc.users.create({ username: 'ok', password: 'corta' }, SUPER), (e) => e.statusCode === 400);
    await assert.rejects(() => svc.users.create({ username: 'solo', password: PASS }, SUPER), (e) => e.statusCode === 409);
  });

  test('un rol se expande a su paquete y * absorbe el resto', async () => {
    const u = await svc.users.create({ username: 'rev', password: PASS, permissions: ['reviewer'] }, SUPER);
    assert.ok(u.permissions.includes('git:read'));
    assert.ok(!u.permissions.includes('terminal:spawn'));
    const admin = svc.users.setPermissions(u.id, ['*', 'fs:read'], SUPER);
    assert.deepEqual(admin.permissions, ['*']);
  });
});
