import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, services, server, SUPER, PASS, q } from './helpers.js';

/**
 * Cliente nativo de Claude, sobre el Agent SDK.
 *
 * Estos tests NO hablan con la API de Anthropic: verifican la frontera, el
 * aislamiento entre usuarios y la validación de opciones, que es lo que puede
 * romperse en silencio. La conversación real se probó a mano; automatizarla
 * gastaría cuota en cada corrida.
 */
describe('claude nativo', () => {
  const sb = sandbox(['proj/app', 'afuera']);
  const svc = services(sb, { proj: 'proj' });

  test('la frontera de rutas también aplica acá', async () => {
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');

    assert.equal((await as('eddy', 'POST', '/api/claude', { cwd: '/etc' })).status, 403);
    assert.equal((await as('eddy', 'POST', '/api/claude', { cwd: sb.at('afuera') })).status, 403);
    assert.equal((await as('eddy', 'GET', `/api/claude/history?cwd=${q('/etc')}`)).status, 403);
  });

  test('sin module:claude no se alcanza nada del módulo', async () => {
    const sb2 = sandbox(['proj/app']);
    const svc2 = services(sb2, { proj: 'proj' });
    await svc2.users.create({ username: 'rev', password: PASS, permissions: ['reviewer'] }, SUPER);
    const { as, login } = await server(svc2);
    await login('rev');

    assert.equal((await as('rev', 'GET', '/api/claude')).status, 403);
    assert.equal((await as('rev', 'POST', '/api/claude', { cwd: sb2.at('proj/app') })).status, 403);
    assert.equal((await as('rev', 'GET', `/api/claude/history?cwd=${q(sb2.at('proj/app'))}`)).status, 403);
  });

  test('una conversación de otro usuario no existe', async () => {
    const sb3 = sandbox(['proj/app']);
    const svc3 = services(sb3, { proj: 'proj' });
    await svc3.users.create({ username: 'ana', password: PASS, permissions: ['admin'] }, SUPER);
    await svc3.users.create({ username: 'bruno', password: PASS, permissions: ['dev'] }, SUPER);
    const { as, login } = await server(svc3);
    await login('ana');
    await login('bruno');

    const mia = await as('ana', 'POST', '/api/claude', { cwd: sb3.at('proj/app') });
    assert.equal(mia.status, 200);

    assert.equal((await as('bruno', 'GET', '/api/claude')).body.conversations.length, 0);
    assert.equal((await as('bruno', 'PATCH', `/api/claude/${mia.body.id}`, { model: 'opus' })).status, 404);
    assert.equal((await as('bruno', 'DELETE', `/api/claude/${mia.body.id}`)).status, 404);

    await as('ana', 'DELETE', `/api/claude/${mia.body.id}`);
  });

  test('el modelo y el modo se validan contra la lista', async () => {
    const sb4 = sandbox(['proj/app']);
    const svc4 = services(sb4, { proj: 'proj' });
    const user = await svc4.users.create({ username: 'carla', password: PASS, permissions: ['admin'] }, SUPER);

    const c = svc4.claude.crear(
      { cwd: sb4.at('proj/app'), model: 'inventado', permissionMode: 'tampoco' },
      user,
    );
    assert.equal(c.model, 'default', 'un modelo desconocido cae a default');
    assert.equal(c.permissionMode, 'default');

    const ok = svc4.claude.crear(
      { cwd: sb4.at('proj/app'), model: 'sonnet', permissionMode: 'plan' },
      user,
    );
    assert.equal(ok.model, 'sonnet');
    assert.equal(ok.permissionMode, 'plan');

    svc4.claude.cerrar(c.id, user);
    svc4.claude.cerrar(ok.id, user);
  });
});
