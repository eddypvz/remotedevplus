import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, services, server, SUPER, PASS } from './helpers.js';

describe('autenticación', () => {
  const sb = sandbox(['www']);
  const svc = services(sb, { www: 'www' });

  test('login, sesión y revocación', async () => {
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);

    let r = await as('eddy', 'GET', '/api/auth/me');
    assert.equal(r.body.authenticated, false, 'sin cookie no hay sesión');

    r = await as('eddy', 'GET', '/api/fs/roots');
    assert.equal(r.status, 401, 'la API exige sesión');

    r = await as('eddy', 'POST', '/api/auth/login', { username: 'eddy', password: 'incorrecta' });
    assert.equal(r.status, 401);

    r = await login('eddy');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user.permissions, ['*']);

    r = await as('eddy', 'GET', '/api/fs/roots');
    assert.equal(r.status, 200, 'con sesión sí');

    await as('eddy', 'POST', '/api/auth/logout');
    r = await as('eddy', 'GET', '/api/auth/me');
    assert.equal(r.body.authenticated, false, 'logout revoca de verdad');
  });

  test('el tiempo de login no revela si el usuario existe', async () => {
    const sb2 = sandbox(['www']);
    const svc2 = services(sb2, { www: 'www' });
    await svc2.users.create({ username: 'ana', password: PASS, permissions: ['admin'] }, SUPER);
    // El hash señuelo se precalienta al construir el servicio; sin esa espera el
    // primer intento pagaría dos scrypt y el test mediría eso.
    await new Promise((r) => setTimeout(r, 400));

    const unaMedicion = async (username) => {
      const t = process.hrtime.bigint();
      await svc2.auth.login({ username, password: 'incorrecta', ip: '1.1.1.1' }).catch(() => {});
      return Number(process.hrtime.bigint() - t) / 1e6;
    };

    // Se alternan las mediciones en vez de hacer una tanda de cada una. Si la
    // máquina se pone lenta a mitad del test —otro proceso, el planificador—,
    // alternar reparte esa lentitud entre ambas; una tanda tras otra se la
    // comería solo la segunda y el test fallaría sin que haya una fuga real.
    const existe = [];
    const noExiste = [];
    for (let i = 0; i < 7; i++) {
      existe.push(await unaMedicion('ana'));
      noExiste.push(await unaMedicion('fantasma'));
    }
    const mediana = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const a = mediana(existe);
    const b = mediana(noExiste);
    const desvio = Math.abs(a - b) / Math.max(a, b);
    assert.ok(desvio < 0.4, `los tiempos difieren ${(desvio * 100).toFixed(0)}%: ${a.toFixed(0)}ms vs ${b.toFixed(0)}ms`);
  });

  test('bloqueo por IP tras varios fallos, sin afectar a otras IP', async () => {
    const sb3 = sandbox(['www']);
    const svc3 = services(sb3, { www: 'www' });
    svc3.cfg.loginMaxAttempts = 3;
    const auth = svc3.auth;
    await svc3.users.create({ username: 'luis', password: PASS, permissions: ['admin'] }, SUPER);

    for (let i = 0; i < 3; i++) {
      await auth.login({ username: 'luis', password: 'x', ip: '9.9.9.9' }).catch(() => {});
    }
    await assert.rejects(
      () => auth.login({ username: 'luis', password: PASS, ip: '9.9.9.9' }),
      (e) => e.statusCode === 429,
      'la IP que falló queda bloqueada aunque acierte',
    );
    const ok = await auth.login({ username: 'luis', password: PASS, ip: '8.8.8.8' });
    assert.ok(ok.token, 'otra IP no queda bloqueada');
  });

  test('un usuario desactivado no entra y pierde sus sesiones', async () => {
    const sb4 = sandbox(['www']);
    const svc4 = services(sb4, { www: 'www' });
    const u = await svc4.users.create({ username: 'ex', password: PASS, permissions: ['dev'] }, SUPER);
    const { token } = await svc4.auth.login({ username: 'ex', password: PASS, ip: '1.1.1.1' });
    assert.ok(svc4.auth.resolve(token), 'la sesión vale');

    svc4.users.setDisabled(u.id, true, SUPER);
    assert.equal(svc4.auth.resolve(token), null, 'desactivar invalida la sesión viva');
    await assert.rejects(() => svc4.auth.login({ username: 'ex', password: PASS, ip: '1.1.1.1' }));
  });
});
