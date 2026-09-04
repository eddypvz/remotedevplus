import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, utimesSync } from 'node:fs';
import { sandbox, services, server, SUPER, PASS, q } from './helpers.js';
import { transcriptDeDisco } from '../apps/agent/src/services/claude.js';

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

describe('leer el transcript de una sesión desde el disco', () => {
  /**
   * Existe porque `getSessionMessages` no sirve para una conversación larga:
   * sigue la cadena de mensajes padre y una compactación la rompe. Medido en
   * una sesión real de 4613 líneas devolvió 143 mensajes, de los cuales solo 70
   * estaban en ese archivo, y se detuvo doce horas antes del final.
   */
  const jsonl = (...objetos) => objetos.map((o) => JSON.stringify(o)).join('\n') + '\n';

  test('devuelve la conversación en orden y descarta lo que no es un mensaje', async () => {
    const sb = sandbox(['proyectos/-var-www-uno']);
    const id = 'aaaaaaaa-1111-2222-3333-444444444444';
    writeFileSync(sb.at('proyectos', '-var-www-uno', `${id}.jsonl`), jsonl(
      { type: 'user', uuid: 'u1', message: { content: 'hola' } },
      // Ruido real del archivo: nada de esto es un mensaje de la conversación.
      { type: 'file-history-snapshot', uuid: 'x1' },
      { type: 'ai-title', uuid: 'x2' },
      { type: 'assistant', uuid: 'a1', message: { content: 'qué tal' } },
      { type: 'queue-operation', uuid: 'x3' },
      { type: 'user', uuid: 'u2', message: { content: 'adiós' } },
    ));

    const m = await transcriptDeDisco(id, sb.at('proyectos'));
    assert.deepEqual(m.map((x) => x.uuid), ['u1', 'a1', 'u2'], 'orden o filtrado incorrectos');
    assert.deepEqual(m.map((x) => x.type), ['user', 'assistant', 'user']);
    assert.equal(m[0].session_id, id, 'sin sessionId en la línea, se usa el pedido');
  });

  test('una línea corrupta no tira la lectura entera', async () => {
    const sb = sandbox(['proyectos/-var-www-uno']);
    const id = 'bbbbbbbb-1111-2222-3333-444444444444';
    writeFileSync(sb.at('proyectos', '-var-www-uno', `${id}.jsonl`),
      jsonl({ type: 'user', uuid: 'u1', message: {} })
      + '{esto no es json\n'
      + jsonl({ type: 'assistant', uuid: 'a1', message: {} }));

    const m = await transcriptDeDisco(id, sb.at('proyectos'));
    assert.deepEqual(m.map((x) => x.uuid), ['u1', 'a1'], 'una línea rota no debe cortar el resto');
  });

  test('busca en todos los proyectos, sin adivinar cómo se codifica el nombre', async () => {
    // La codificación de esas carpetas no está documentada; derivarla de la
    // ruta es una suposición que después falla en silencio.
    const sb = sandbox(['proyectos/-var-www-uno', 'proyectos/-var-www-otro-raro']);
    const id = 'cccccccc-1111-2222-3333-444444444444';
    writeFileSync(sb.at('proyectos', '-var-www-otro-raro', `${id}.jsonl`),
      jsonl({ type: 'user', uuid: 'u1', message: {} }));

    const m = await transcriptDeDisco(id, sb.at('proyectos'));
    assert.equal(m.length, 1);
  });

  test('si el id está en dos proyectos, gana el modificado más recientemente', async () => {
    /*
     * Renombrar la carpeta de un proyecto deja una copia con el nombre viejo, y
     * `readdir` no promete orden —el nombre viejo suele ordenar antes. Leer el
     * primero que aparezca mostraba una copia congelada: la conversación como
     * estaba horas antes, con el último mensaje viejo.
     */
    const sb = sandbox(['proyectos/-var-www-viejo', 'proyectos/-var-www-nuevo']);
    const id = 'dddddddd-1111-2222-3333-444444444444';
    const rancio = sb.at('proyectos', '-var-www-viejo', `${id}.jsonl`);
    const vivo = sb.at('proyectos', '-var-www-nuevo', `${id}.jsonl`);

    writeFileSync(rancio, jsonl({ type: 'user', uuid: 'viejo', message: {} }));
    writeFileSync(vivo, jsonl(
      { type: 'user', uuid: 'viejo', message: {} },
      { type: 'assistant', uuid: 'reciente', message: {} },
    ));
    // El rancio, más antiguo a propósito, y con nombre que ordena primero.
    utimesSync(rancio, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));

    const m = await transcriptDeDisco(id, sb.at('proyectos'));
    assert.equal(m.length, 2, 'leyó la copia congelada en vez de la que se está escribiendo');
    assert.equal(m[m.length - 1].uuid, 'reciente');
  });

  test('sin archivo devuelve vacío, no falla', async () => {
    const sb = sandbox(['proyectos']);
    assert.deepEqual(await transcriptDeDisco('no-existe', sb.at('proyectos')), []);
    assert.deepEqual(await transcriptDeDisco('no-existe', sb.at('ni-la-carpeta')), []);
  });
});
