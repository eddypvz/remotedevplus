import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPathGuard, userRoots } from '../apps/agent/src/paths.js';
import { sandbox } from './helpers.js';

/**
 * La frontera de seguridad del sistema. Si algo de acá se rompe, un usuario
 * alcanza archivos que no le corresponden, así que estos casos son adversarios
 * a propósito.
 */
describe('frontera de rutas', () => {
  const sb = sandbox(
    ['raiz/sub', 'afuera', 'raizmala'],
    { 'raiz/sub/a.txt': 'hola', 'afuera/secreto': 'ssh' },
  );
  sb.link('afuera', 'raiz/escape');

  const cfg = { roots: [{ name: 'raiz', path: sb.at('raiz'), host: 'local' }] };
  const guard = createPathGuard(cfg);
  const user = { permissions: ['*'], roots: null };

  const rechaza = (t, path, code) => test(t, async () => {
    await assert.rejects(() => guard.resolvePath(user, path), (e) => e.statusCode === code);
  });

  test('acepta una ruta dentro de la raíz', async () => {
    const r = await guard.resolvePath(user, sb.at('raiz/sub/a.txt'));
    assert.equal(r.path, sb.at('raiz/sub/a.txt'));
    assert.equal(r.root.name, 'raiz');
  });

  rechaza('rechaza el traversal con ..', sb.at('raiz/sub/../../afuera/secreto'), 403);
  rechaza('rechaza un symlink que sale de la raíz', sb.at('raiz/escape/secreto'), 403);
  rechaza('no confunde /raiz con /raizmala', sb.at('raizmala'), 403);
  rechaza('rechaza lo que no existe y además escapa', sb.at('raiz/escape/nuevo.txt'), 403);

  test('acepta una ruta que aún no existe, para poder crearla', async () => {
    const r = await guard.resolvePath(user, sb.at('raiz/sub/nuevo.txt'));
    assert.equal(r.path, sb.at('raiz/sub/nuevo.txt'));
  });

  test('mustExist rechaza lo que no existe', async () => {
    await assert.rejects(
      () => guard.resolvePath(user, sb.at('raiz/sub/nuevo.txt'), { mustExist: true }),
      (e) => e.statusCode === 404,
    );
  });

  test('un usuario sin ninguna raíz asignada no alcanza nada', async () => {
    const ajeno = { permissions: ['*'], roots: ['otra'] };
    await assert.rejects(
      () => guard.resolvePath(ajeno, sb.at('raiz/sub/a.txt')),
      (e) => e.statusCode === 403,
    );
  });
});

describe('formas de user.roots', () => {
  const sb = sandbox(['var/www', 'var/juan', 'etc']);
  const cfg = { roots: [{ name: 'www', path: sb.at('var/www'), host: 'local' }] };

  const nombres = (u) => userRoots(cfg, u).map((r) => r.name).sort();

  test('null hereda las raíces del agente', () => {
    assert.deepEqual(nombres({ roots: null }), ['www']);
  });

  test('una lista vacía también hereda', () => {
    assert.deepEqual(nombres({ roots: [] }), ['www']);
  });

  test('la forma legada de nombres sigue filtrando las del agente', () => {
    assert.deepEqual(nombres({ roots: ['www'] }), ['www']);
    assert.deepEqual(nombres({ roots: ['inexistente'] }), []);
  });

  test('las rutas propias reemplazan a las del agente', () => {
    const u = { roots: [{ name: 'juan', path: sb.at('var/juan') }] };
    assert.deepEqual(userRoots(cfg, u), [{ name: 'juan', path: sb.at('var/juan'), host: 'local' }]);
  });
});
