import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { asignarCarriles } from '../apps/agent/src/services/git.js';
import { sandbox, services, server, SUPER, PASS, q } from './helpers.js';

/**
 * El reparto de carriles del árbol de commits.
 *
 * Es lo único del módulo que no se puede verificar a ojo: un carril mal
 * asignado dibuja una rama saliendo del commit equivocado, y eso en un gráfico
 * grande pasa desapercibido hasta que alguien confía en él para decidir algo.
 */
describe('carriles del árbol', () => {
  /** Los commits llegan en orden de fecha, del más nuevo al más viejo. */
  const c = (hash, ...parents) => ({ hash, parents });

  test('una historia lineal ocupa un solo carril', () => {
    const r = asignarCarriles([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')]);
    assert.deepEqual(r.map((x) => x.carril), [0, 0, 0, 0]);
    assert.deepEqual(r.map((x) => x.ancho), [1, 1, 1, 0]);
  });

  test('una rama abre un carril y la fusión lo cierra', () => {
    //  e (merge de d y c)
    //  |\
    //  d c
    //  |/
    //  b
    //  a
    const r = asignarCarriles([
      c('e', 'd', 'c'), c('d', 'b'), c('c', 'b'), c('b', 'a'), c('a'),
    ]);
    const por = Object.fromEntries(r.map((x) => [x.hash, x]));

    assert.equal(por.e.carril, 0, 'la fusión queda en el carril principal');
    assert.equal(por.e.salidas.length, 2, 'y sale hacia sus dos padres');
    assert.notEqual(por.d.carril, por.c.carril, 'las dos ramas van en carriles distintos');
    assert.equal(por.b.carril, por.d.carril, 'el ancestro común continúa el carril del primer padre');
    assert.equal(por.a.ancho, 0, 'al final no queda ningún carril abierto');
  });

  test('un carril liberado se reutiliza en vez de crecer a lo ancho', () => {
    // Dos ramas que se fusionan y después otra rama nueva: la nueva debería
    // usar el hueco, no una cuarta columna.
    const r = asignarCarriles([
      c('f', 'e', 'x'), c('x', 'b'), c('e', 'd', 'c'), c('d', 'b'), c('c', 'b'), c('b', 'a'), c('a'),
    ]);
    assert.ok(Math.max(...r.map((x) => x.ancho)) <= 3, 'no se abre un carril de más');
  });

  test('varias raíces sin relación no se mezclan', () => {
    const r = asignarCarriles([c('b'), c('a')]);
    assert.equal(r[0].carril, 0);
    assert.equal(r[1].carril, 0, 'el carril del primero quedó libre y se reutiliza');
  });

  test('una punta de rama no recibe línea desde arriba', () => {
    // d es la cabeza: nadie la nombra como padre, así que no le baja nada.
    const r = asignarCarriles([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')]);
    assert.equal(r[0].entraArriba, false, 'la cabeza es una punta');
    assert.ok(r.slice(1).every((x) => x.entraArriba), 'el resto sí continúa una línea');
  });

  test('el commit inicial cierra su carril', () => {
    const r = asignarCarriles([c('a')]);
    assert.deepEqual(r[0].salidas, []);
    assert.equal(r[0].ancho, 0);
  });
});

describe('git sobre un repositorio real', () => {
  const sb = sandbox(['repo']);
  const svc = services(sb, { repo: 'repo' });
  const en = (...args) => execFileSync('git', args, { cwd: sb.at('repo'), encoding: 'utf8' });

  test('estado, grafo, ramas y stash', async () => {
    en('init', '-q', '-b', 'principal');
    en('config', 'user.email', 'test@ejemplo.com');
    en('config', 'user.name', 'Prueba');
    sb.at('repo');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(sb.at('repo', 'uno.txt'), 'primero\n');
    en('add', '.'); en('commit', '-qm', 'primer commit');

    // Una rama que se fusiona, para que el grafo tenga algo que repartir
    en('switch', '-qc', 'rama');
    writeFileSync(sb.at('repo', 'dos.txt'), 'segundo\n');
    en('add', '.'); en('commit', '-qm', 'en la rama');
    en('switch', '-q', 'principal');
    writeFileSync(sb.at('repo', 'tres.txt'), 'tercero\n');
    en('add', '.'); en('commit', '-qm', 'en principal');
    en('merge', '-q', '--no-ff', 'rama', '-m', 'fusión');

    // Trabajo sin commitear, de los tres tipos
    writeFileSync(sb.at('repo', 'uno.txt'), 'cambiado\n');
    writeFileSync(sb.at('repo', 'nuevo.txt'), 'sin rastrear\n');
    writeFileSync(sb.at('repo', 'preparado.txt'), 'listo\n');
    en('add', 'preparado.txt');

    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');
    const cwd = q(sb.at('repo'));

    let r = await as('eddy', 'GET', `/api/git/status?cwd=${cwd}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.rama, 'principal');
    assert.deepEqual(r.body.preparados.map((x) => x.ruta), ['preparado.txt']);
    assert.deepEqual(r.body.cambiados.map((x) => x.ruta), ['uno.txt']);
    assert.deepEqual(r.body.sinRastrear.map((x) => x.ruta), ['nuevo.txt']);

    r = await as('eddy', 'GET', `/api/git/graph?cwd=${cwd}`);
    assert.equal(r.body.commits.length, 4);
    const fusion = r.body.commits.find((x) => x.asunto === 'fusión');
    assert.equal(fusion.parents.length, 2, 'la fusión tiene dos padres');
    assert.equal(fusion.salidas.length, 2, 'y dos salidas en el grafo');
    assert.ok(r.body.commits.every((x) => typeof x.carril === 'number'));

    r = await as('eddy', 'GET', `/api/git/branches?cwd=${cwd}`);
    const nombres = r.body.ramas.map((x) => x.nombre);
    assert.ok(nombres.includes('principal') && nombres.includes('rama'));
    assert.ok(r.body.ramas.find((x) => x.nombre === 'principal').actual);

    // Stash: lo que más se usa para no perder cambios antes de un pull
    r = await as('eddy', 'POST', '/api/git/stash', { cwd: sb.at('repo'), message: 'antes del pull' });
    assert.equal(r.status, 200);
    r = await as('eddy', 'GET', `/api/git/stash?cwd=${cwd}`);
    assert.equal(r.body.entradas.length, 1);
    assert.equal(r.body.entradas[0].mensaje, 'antes del pull');
    assert.ok(r.body.entradas[0].archivos.includes('uno.txt'), 'dice qué archivos toca');

    r = await as('eddy', 'GET', `/api/git/status?cwd=${cwd}`);
    assert.equal(r.body.cambiados.length, 0, 'el stash limpió el árbol');

    r = await as('eddy', 'POST', '/api/git/stash/apply', { cwd: sb.at('repo'), ref: 'stash@{0}', pop: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.estado.cambiados.some((x) => x.ruta === 'uno.txt'), 'y pop lo devuelve');

    // Commit
    r = await as('eddy', 'POST', '/api/git/commit', { cwd: sb.at('repo'), message: 'desde la API' });
    assert.equal(r.status, 200);
    assert.equal(r.body.estado.preparados.length, 0);
  });

  test('el detalle de un commit dice qué archivos tocó y cuánto', async () => {
    const sb2 = sandbox(['r']);
    const svc2 = services(sb2, { r: 'r' });
    const en = (...a) => execFileSync('git', a, { cwd: sb2.at('r'), encoding: 'utf8' });
    const { writeFileSync } = await import('node:fs');

    en('init', '-q', '-b', 'principal');
    en('config', 'user.email', 'ana@ejemplo.com');
    en('config', 'user.name', 'Ana');
    writeFileSync(sb2.at('r', 'viejo.txt'), 'a\nb\nc\n');
    en('add', '.'); en('commit', '-qm', 'inicial');

    writeFileSync(sb2.at('r', 'viejo.txt'), 'a\nB\nc\nd\n');   // 2 más, 1 menos
    writeFileSync(sb2.at('r', 'nuevo.txt'), 'uno\ndos\n');       // 2 más
    en('rm', '-q', '--cached', 'viejo.txt'); en('add', '.');
    en('commit', '-qm', 'segundo commit\n\nCon un cuerpo explicativo.');

    await svc2.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc2);
    await login('eddy');
    const c = q(sb2.at('r'));
    const hash = en('rev-parse', 'HEAD').trim();

    const r = await as('eddy', 'GET', `/api/git/commit?cwd=${c}&hash=${hash}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.autor, 'Ana', 'dice quién lo hizo');
    assert.equal(r.body.asunto, 'segundo commit');
    assert.equal(r.body.cuerpo, 'Con un cuerpo explicativo.');
    assert.equal(r.body.esFusion, false);

    const rutas = r.body.archivos.map((a) => a.ruta).sort();
    assert.deepEqual(rutas, ['nuevo.txt', 'viejo.txt']);
    const nuevo = r.body.archivos.find((a) => a.ruta === 'nuevo.txt');
    assert.equal(nuevo.estado, 'agregado');
    assert.equal(nuevo.mas, 2);
    assert.equal(nuevo.menos, 0);
    const viejo = r.body.archivos.find((a) => a.ruta === 'viejo.txt');
    assert.equal(viejo.mas, 2, 'cuenta las líneas que entraron');
    assert.equal(viejo.menos, 1, 'y las que salieron');
    assert.equal(r.body.total.archivos, 2);

    const d = await as('eddy', 'GET', `/api/git/commit/diff?cwd=${c}&hash=${hash}&path=nuevo.txt`);
    assert.ok(d.body.diff.includes('+uno'), 'el diff del archivo en ese commit');

    assert.equal((await as('eddy', 'GET', `/api/git/commit?cwd=${c}&hash=noesunhash`)).status, 400);
  });

  test('una fusión muestra lo que trajo a la rama', async () => {
    const sb3 = sandbox(['r']);
    const svc3 = services(sb3, { r: 'r' });
    const en = (...a) => execFileSync('git', a, { cwd: sb3.at('r'), encoding: 'utf8' });
    const { writeFileSync } = await import('node:fs');

    en('init', '-q', '-b', 'principal');
    en('config', 'user.email', 'x@y.z'); en('config', 'user.name', 'X');
    writeFileSync(sb3.at('r', 'base.txt'), 'base\n');
    en('add', '.'); en('commit', '-qm', 'base');
    en('switch', '-qc', 'rama');
    writeFileSync(sb3.at('r', 'deRama.txt'), 'rama\n');
    en('add', '.'); en('commit', '-qm', 'en rama');
    en('switch', '-q', 'principal');
    en('merge', '-q', '--no-ff', 'rama', '-m', 'fusión');

    await svc3.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc3);
    await login('eddy');
    const hash = en('rev-parse', 'HEAD').trim();

    const r = await as('eddy', 'GET', `/api/git/commit?cwd=${q(sb3.at('r'))}&hash=${hash}`);
    assert.equal(r.body.esFusion, true);
    assert.deepEqual(r.body.archivos.map((a) => a.ruta), ['deRama.txt'],
      'sin --first-parent una fusión no mostraría ningún archivo');
  });

  test('con HEAD desprendido se sabe dónde está parado', async () => {
    const sb4 = sandbox(['r']);
    const svc4 = services(sb4, { r: 'r' });
    const en = (...a) => execFileSync('git', a, { cwd: sb4.at('r'), encoding: 'utf8' });
    const { writeFileSync } = await import('node:fs');

    en('init', '-q', '-b', 'principal');
    en('config', 'user.email', 'x@y.z'); en('config', 'user.name', 'X');
    writeFileSync(sb4.at('r', 'a.txt'), 'a\n'); en('add', '.'); en('commit', '-qm', 'primero');
    writeFileSync(sb4.at('r', 'b.txt'), 'b\n'); en('add', '.'); en('commit', '-qm', 'segundo');

    await svc4.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc4);
    await login('eddy');
    const c = q(sb4.at('r'));

    let r = await as('eddy', 'GET', `/api/git/status?cwd=${c}`);
    assert.equal(r.body.desprendido, false);
    assert.equal(r.body.rama, 'principal');

    const viejo = en('rev-parse', 'HEAD~1').trim();
    en('checkout', '-q', viejo);

    r = await as('eddy', 'GET', `/api/git/status?cwd=${c}`);
    assert.equal(r.body.desprendido, true, 'se detecta el desprendimiento');
    assert.equal(r.body.oidCorto, viejo.slice(0, 7), 'y se sabe en qué commit');

    // Lo que hace que el árbol pueda marcarlo: la ref `HEAD` a secas.
    const g = await as('eddy', 'GET', `/api/git/graph?cwd=${c}`);
    const parado = g.body.commits.find((x) => x.hash === viejo);
    assert.ok(parado.refs.includes('HEAD'),
      'el commit donde está parado trae la ref HEAD suelta');
    const otro = g.body.commits.find((x) => x.hash !== viejo);
    assert.ok(!otro.refs.includes('HEAD'), 'y ningún otro la trae');
  });

  test('el checkout prefiere la rama local antes que el commit', async () => {
    const sb5 = sandbox(['r']);
    const svc5 = services(sb5, { r: 'r' });
    const en = (...a) => execFileSync('git', a, { cwd: sb5.at('r'), encoding: 'utf8' });
    const { writeFileSync } = await import('node:fs');

    en('init', '-q', '-b', 'principal');
    en('config', 'user.email', 'x@y.z'); en('config', 'user.name', 'X');
    writeFileSync(sb5.at('r', 'a.txt'), 'a\n'); en('add', '.'); en('commit', '-qm', 'primero');
    en('branch', 'etiquetada');
    writeFileSync(sb5.at('r', 'b.txt'), 'b\n'); en('add', '.'); en('commit', '-qm', 'segundo');

    const usuario = { id: 1, permissions: ['*'], roots: null };
    const conRama = en('rev-parse', 'HEAD~1').trim();

    // Ese commit tiene la rama "etiquetada" apuntándole: se va a la rama.
    let r = await svc5.git.situarse(usuario, sb5.at('r'), conRama);
    assert.equal(r.destino, 'etiquetada');
    assert.equal(r.desprendido, false, 'no deja al usuario en HEAD desprendido sin pedirlo');

    // Un commit sin rama sí deja desprendido, y se avisa.
    en('checkout', '-q', 'principal');
    const sinRama = en('rev-parse', 'HEAD').trim();
    en('branch', '-D', 'etiquetada');
    r = await svc5.git.situarse(usuario, sb5.at('r'), sinRama);
    assert.equal(r.destino, 'principal', 'principal apunta a este commit');
  });

  test('una carpeta fuera de las raíces se rechaza', async () => {
    const sb2 = sandbox(['x']);
    const svc2 = services(sb2, { x: 'x' });
    await svc2.users.create({ username: 'ana', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc2);
    await login('ana');
    assert.equal((await as('ana', 'GET', '/api/git/status?cwd=/etc')).status, 403);
  });

  test('sin git:read no se alcanza nada', async () => {
    const sb3 = sandbox(['y']);
    const svc3 = services(sb3, { y: 'y' });
    await svc3.users.create({
      username: 'luis', password: PASS, permissions: ['module:file', 'fs:read'],
    }, SUPER);
    const { as, login } = await server(svc3);
    await login('luis');
    assert.equal((await as('luis', 'GET', `/api/git/status?cwd=${q(sb3.at('y'))}`)).status, 403);
  });
});
