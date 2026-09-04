import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, services, server, SUPER, PASS, q } from './helpers.js';

describe('workspaces', () => {
  const sb = sandbox(['proj/backend/src', 'proj/frontend/src', 'proj/otro', 'afuera/secreto']);
  const svc = services(sb, { proj: 'proj', otra: 'afuera' });

  test('el flujo completo, y que un workspace no otorgue acceso', async () => {
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');

    // --- crear con dos carpetas: el caso backend + frontend ---
    let r = await as('eddy', 'POST', '/api/workspaces', {
      name: 'proyecto1',
      folders: [{ name: 'backend', path: sb.at('proj/backend') }, { path: sb.at('proj/frontend') }],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.folders.map((f) => f.name), ['backend', 'frontend'],
      'el nombre por defecto sale del basename');
    const id = r.body.id;

    // --- la invariante: es una vista, no un permiso ---
    assert.equal((await as('eddy', 'POST', '/api/workspaces', { name: 'malo', folders: ['/etc'] })).status, 403);
    assert.equal((await as('eddy', 'POST', '/api/workspaces', { name: 'x', folders: [sb.at('proj/nada')] })).status, 404);
    assert.equal((await as('eddy', 'POST', '/api/workspaces', { name: 'y', folders: [] })).status, 400);
    assert.equal((await as('eddy', 'POST', '/api/workspaces', { name: 'proyecto1', folders: [sb.at('proj/otro')] })).status, 409);

    // --- duplicados y validación en vivo ---
    r = await as('eddy', 'PATCH', `/api/workspaces/${id}`, {
      folders: [sb.at('proj/backend'), sb.at('proj/backend'), sb.at('proj/otro')],
    });
    assert.equal(r.body.folders.length, 2, 'la misma carpeta dos veces se colapsa');

    r = await as('eddy', 'GET', `/api/workspaces/check?path=${q(sb.at('proj/frontend'))}`);
    assert.equal(r.body.ok, true);
    assert.equal((await as('eddy', 'GET', '/api/workspaces/check?path=/etc')).body.ok, false);

    // --- si le recortan las raíces después, deja de mostrar ---
    await as('eddy', 'PATCH', `/api/workspaces/${id}`, {
      folders: [sb.at('proj/backend'), sb.at('afuera/secreto')],
    });
    assert.equal((await as('eddy', 'GET', `/api/workspaces/${id}`)).body.unavailable, 0);

    svc.users.setRoots(1, [{ name: 'proj', path: sb.at('proj') }], SUPER);
    r = await as('eddy', 'GET', `/api/workspaces/${id}`);
    assert.equal(r.body.folders.length, 1, 'la carpeta fuera de sus raíces ya no se devuelve');
    assert.equal(r.body.unavailable, 1, 'pero se avisa que existe');
    assert.ok(!r.body.folders.some((f) => f.path.includes('afuera')));

    // --- abrir y borrar ---
    r = await as('eddy', 'POST', `/api/workspaces/${id}/open`);
    assert.ok(r.body.openedAt, 'open marca openedAt en la respuesta, no en la siguiente lectura');
    assert.equal((await as('eddy', 'DELETE', `/api/workspaces/${id}`)).status, 200);
    assert.equal((await as('eddy', 'GET', '/api/workspaces')).body.workspaces.length, 0);
  });

  test('un workspace es de su dueño y de nadie más', async () => {
    const sb2 = sandbox(['proj/app']);
    const svc2 = services(sb2, { proj: 'proj' });
    await svc2.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    await svc2.users.create({ username: 'ana', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc2);
    await login('eddy');
    await login('ana');

    const mio = await as('eddy', 'POST', '/api/workspaces', { name: 'de-eddy', folders: [sb2.at('proj/app')] });
    assert.equal((await as('ana', 'GET', '/api/workspaces')).body.workspaces.length, 0);
    assert.equal((await as('ana', 'GET', `/api/workspaces/${mio.body.id}`)).status, 404);
    assert.equal((await as('ana', 'DELETE', `/api/workspaces/${mio.body.id}`)).status, 404);
  });
});

describe('cuerpo JSON vacío', () => {
  const sb = sandbox(['www']);
  const svc = services(sb, { www: 'www' });

  test('un POST sin cuerpo con content-type json no da 400', async () => {
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');
    const w = await as('eddy', 'POST', '/api/workspaces', { name: 'w', folders: [sb.at('www')] });
    // `as` manda content-type siempre; sin cuerpo Fastify daría
    // FST_ERR_CTP_EMPTY_JSON_BODY si no lo tratáramos como {}.
    assert.equal((await as('eddy', 'POST', `/api/workspaces/${w.body.id}/open`)).status, 200);
    assert.equal((await as('eddy', 'DELETE', `/api/workspaces/${w.body.id}`)).status, 200);
  });
});
