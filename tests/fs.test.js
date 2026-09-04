import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { sandbox, services, server, SUPER, PASS, q } from './helpers.js';

/** Sube bytes crudos, como hace el navegador con un `File`. */
async function subir(base, cookie, dir, name, contenido) {
  const res = await fetch(`${base}/api/fs/upload?dir=${q(dir)}&name=${q(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', origin: base, cookie },
    body: Buffer.from(contenido),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('operaciones de archivos', () => {
  test('subir escribe los bytes y no pisa lo que ya existe', async () => {
    const sb = sandbox(['proj']);
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { base, login, cookieOf } = await server(svc);
    await login('eddy');
    const cookie = cookieOf('eddy');

    let r = await subir(base, cookie, sb.at('proj'), 'notas.md', '# hola');
    assert.equal(r.status, 200);
    assert.equal(readFileSync(sb.at('proj', 'notas.md'), 'utf8'), '# hola');

    // El segundo con el mismo nombre no pisa: se corre a "notas (2).md".
    r = await subir(base, cookie, sb.at('proj'), 'notas.md', 'otro');
    assert.equal(r.body.name, 'notas (2).md');
    assert.equal(readFileSync(sb.at('proj', 'notas.md'), 'utf8'), '# hola', 'pisó el original');

    // Binario intacto, byte a byte.
    const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 10]);
    r = await subir(base, cookie, sb.at('proj'), 'raro.bin', bytes);
    assert.deepEqual(readFileSync(sb.at('proj', 'raro.bin')), bytes);
  });

  test('el nombre de la subida tiene que ser un nombre, no una ruta', async () => {
    const sb = sandbox(['proj', 'afuera']);
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { base, login, cookieOf } = await server(svc);
    await login('eddy');
    const cookie = cookieOf('eddy');

    for (const malo of ['../fuga.txt', 'sub/dir.txt', '..', '.', '']) {
      const r = await subir(base, cookie, sb.at('proj'), malo, 'x');
      assert.equal(r.status, 400, `aceptó el nombre ${JSON.stringify(malo)}`);
    }
    assert.equal(existsSync(sb.at('fuga.txt')), false);

    // Y el directorio destino pasa por la misma frontera que todo lo demás.
    const fuera = await subir(base, cookie, sb.at('afuera'), 'x.txt', 'x');
    assert.equal(fuera.status, 403);
    assert.equal(existsSync(sb.at('afuera', 'x.txt')), false);
  });

  test('copiar y mover eligen un nombre libre, y no se tragan a sí mismos', async () => {
    const sb = sandbox(['proj/a/hondo', 'proj/b'], {
      'proj/a/uno.txt': 'contenido',
      'proj/a/hondo/dos.txt': 'anidado',
    });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');

    // Copiar un archivo a otra carpeta.
    let r = await as('eddy', 'POST', '/api/fs/copy', { from: sb.at('proj/a/uno.txt'), toDir: sb.at('proj/b') });
    assert.equal(r.status, 200);
    assert.equal(readFileSync(sb.at('proj/b/uno.txt'), 'utf8'), 'contenido');

    // Otra vez: se corre el nombre en vez de pisar.
    r = await as('eddy', 'POST', '/api/fs/copy', { from: sb.at('proj/a/uno.txt'), toDir: sb.at('proj/b') });
    assert.equal(r.body.path, sb.at('proj/b/uno (2).txt'));

    // Copiar una carpeta se lleva su contenido.
    r = await as('eddy', 'POST', '/api/fs/copy', { from: sb.at('proj/a/hondo'), toDir: sb.at('proj/b') });
    assert.equal(readFileSync(sb.at('proj/b/hondo/dos.txt'), 'utf8'), 'anidado');

    // Una carpeta dentro de sí misma sería recursión infinita.
    r = await as('eddy', 'POST', '/api/fs/copy', { from: sb.at('proj/a'), toDir: sb.at('proj/a/hondo') });
    assert.equal(r.status, 400);

    // Mover deja de estar en el origen.
    r = await as('eddy', 'POST', '/api/fs/move', { from: sb.at('proj/a/uno.txt'), toDir: sb.at('proj/b') });
    assert.equal(r.status, 200);
    assert.equal(existsSync(sb.at('proj/a/uno.txt')), false);
    assert.equal(r.body.path, sb.at('proj/b/uno (3).txt'));
  });

  test('no se puede copiar ni mover fuera de las raíces, en ninguna dirección', async () => {
    const sb = sandbox(['proj', 'afuera'], { 'proj/dentro.txt': 'x', 'afuera/ajeno.txt': 'y' });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');

    // Sacar algo afuera.
    let r = await as('eddy', 'POST', '/api/fs/copy', { from: sb.at('proj/dentro.txt'), toDir: sb.at('afuera') });
    assert.equal(r.status, 403);
    // Y traer algo de afuera.
    r = await as('eddy', 'POST', '/api/fs/copy', { from: sb.at('afuera/ajeno.txt'), toDir: sb.at('proj') });
    assert.equal(r.status, 403);
    r = await as('eddy', 'POST', '/api/fs/move', { from: sb.at('afuera/ajeno.txt'), toDir: sb.at('proj') });
    assert.equal(r.status, 403);

    assert.equal(existsSync(sb.at('afuera/dentro.txt')), false);
    assert.equal(existsSync(sb.at('proj/ajeno.txt')), false);
    assert.equal(readFileSync(sb.at('afuera/ajeno.txt'), 'utf8'), 'y');
  });

  test('crear archivo y carpeta: validan el nombre y no pisan', async () => {
    const sb = sandbox(['proj'], { 'proj/ya.txt': 'x' });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { as, login } = await server(svc);
    await login('eddy');

    assert.equal((await as('eddy', 'POST', '/api/fs/create', { dir: sb.at('proj'), name: 'nuevo.txt' })).status, 200);
    assert.equal(readFileSync(sb.at('proj/nuevo.txt'), 'utf8'), '');

    // Pisar en silencio sería peor que fallar.
    assert.equal((await as('eddy', 'POST', '/api/fs/create', { dir: sb.at('proj'), name: 'ya.txt' })).status, 409);
    assert.equal(readFileSync(sb.at('proj/ya.txt'), 'utf8'), 'x');

    assert.equal((await as('eddy', 'POST', '/api/fs/create', { dir: sb.at('proj'), name: '../fuera.txt' })).status, 400);
    assert.equal((await as('eddy', 'POST', '/api/fs/mkdir', { dir: sb.at('proj'), name: 'a/b' })).status, 400);

    assert.equal((await as('eddy', 'POST', '/api/fs/mkdir', { dir: sb.at('proj'), name: 'sub' })).status, 200);
    assert.equal((await as('eddy', 'POST', '/api/fs/mkdir', { dir: sb.at('proj'), name: 'sub' })).status, 409);

    // El destino tiene que ser un directorio, no un archivo.
    assert.equal((await as('eddy', 'POST', '/api/fs/create', { dir: sb.at('proj/ya.txt'), name: 'x' })).status, 400);
  });

  test('descargar devuelve los bytes tal cual, con nombre de adjunto', async () => {
    const sb = sandbox(['proj'], { 'proj/acentué.txt': 'con tilde' });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { base, login, cookieOf } = await server(svc);
    await login('eddy');
    const cookie = cookieOf('eddy');

    // Binario, que es donde una descarga mal hecha se nota.
    const bytes = Buffer.from([0, 159, 146, 150, 10, 0]);
    await subir(base, cookie, sb.at('proj'), 'raro.bin', bytes);

    let res = await fetch(`${base}/api/fs/download?path=${q(sb.at('proj', 'raro.bin'))}`, {
      headers: { origin: base, cookie },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    assert.match(res.headers.get('content-disposition'), /^attachment;/);

    // El nombre con acento va en las dos formas: ASCII y UTF-8 escapado.
    res = await fetch(`${base}/api/fs/download?path=${q(sb.at('proj', 'acentué.txt'))}`, {
      headers: { origin: base, cookie },
    });
    const cd = res.headers.get('content-disposition');
    assert.match(cd, /filename\*=UTF-8''acentu%C3%A9\.txt/);
    assert.equal(await res.text(), 'con tilde');

    // Una carpeta no se descarga: habría que comprimirla.
    res = await fetch(`${base}/api/fs/download?path=${q(sb.at('proj'))}`, { headers: { origin: base, cookie } });
    assert.equal(res.status, 400);
  });

  test('ver en línea solo sirve tipos que el navegador no ejecuta', async () => {
    const sb = sandbox(['proj'], {
      'proj/pagina.html': '<script>alert(1)</script>',
      'proj/codigo.js': 'alert(1)',
      'proj/notas.txt': 'texto',
      'proj/dibujo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { base, login, cookieOf } = await server(svc);
    await login('eddy');
    const cookie = cookieOf('eddy');
    const ver = (f) => fetch(`${base}/api/fs/raw?path=${q(sb.at(f))}`, { headers: { origin: base, cookie } });

    // Un PNG de verdad, con su firma.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    await subir(base, cookie, sb.at('proj'), 'foto.png', png);
    let res = await ver('proj/foto.png');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-disposition'), 'inline');
    // Sin nosniff el navegador puede adivinar otro tipo y la lista blanca no
    // serviría de nada.
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);

    /*
     * Lo importante de este test: servir un .html del repositorio en línea y
     * desde el mismo origen ejecutaría su script con la cookie de sesión
     * puesta. Tiene que rebotar, y con él todo lo que no sea imagen o PDF.
     */
    for (const f of ['proj/pagina.html', 'proj/codigo.js', 'proj/notas.txt']) {
      assert.equal((await ver(f)).status, 415, `sirvió ${f} en línea`);
    }

    // El SVG sí se sirve, pero neutralizado: es un documento, no solo una
    // imagen, y abierto directo en una pestaña ejecutaría scripts.
    res = await ver('proj/dibujo.svg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.equal(res.headers.get('content-security-policy'), 'sandbox');

    // Una carpeta no es un archivo.
    assert.equal((await ver('proj')).status, 415);
  });

  test('ver en línea respeta la frontera de rutas', async () => {
    const sb = sandbox(['proj', 'afuera']);
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { base, login, cookieOf } = await server(svc);
    await login('eddy');
    const cookie = cookieOf('eddy');

    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    writeFileSync(sb.at('afuera', 'ajena.png'), png);
    for (const ruta of [sb.at('afuera', 'ajena.png'), sb.at('proj', '..', 'afuera', 'ajena.png')]) {
      const res = await fetch(`${base}/api/fs/raw?path=${q(ruta)}`, { headers: { origin: base, cookie } });
      assert.equal(res.status, 403, `sirvió ${ruta}`);
    }
  });

  test('no se puede descargar fuera de las raíces', async () => {
    const sb = sandbox(['proj', 'afuera'], { 'afuera/secreto.txt': 'nada de esto' });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'eddy', password: PASS, permissions: ['admin'] }, SUPER);
    const { base, login, cookieOf } = await server(svc);
    await login('eddy');

    for (const ruta of [sb.at('afuera', 'secreto.txt'), '/etc/passwd', sb.at('proj', '..', 'afuera', 'secreto.txt')]) {
      const res = await fetch(`${base}/api/fs/download?path=${q(ruta)}`, {
        headers: { origin: base, cookie: cookieOf('eddy') },
      });
      assert.equal(res.status, 403, `dejó descargar ${ruta}`);
    }
  });

  test('sin fs:write no se escribe nada, aunque se pueda leer', async () => {
    const sb = sandbox(['proj'], { 'proj/uno.txt': 'x' });
    const svc = services(sb, { proj: 'proj' });
    await svc.users.create({ username: 'ana', password: PASS, permissions: ['fs:read'] }, SUPER);
    const { as, base, login, cookieOf } = await server(svc);
    await login('ana');

    assert.equal((await as('ana', 'GET', `/api/fs/list?path=${q(sb.at('proj'))}`)).status, 200);
    assert.equal((await as('ana', 'POST', '/api/fs/create', { dir: sb.at('proj'), name: 'n.txt' })).status, 403);
    assert.equal((await as('ana', 'POST', '/api/fs/mkdir', { dir: sb.at('proj'), name: 'd' })).status, 403);
    assert.equal((await as('ana', 'POST', '/api/fs/copy', { from: sb.at('proj/uno.txt'), toDir: sb.at('proj') })).status, 403);
    assert.equal((await as('ana', 'POST', '/api/fs/move', { from: sb.at('proj/uno.txt'), toDir: sb.at('proj') })).status, 403);
    assert.equal((await subir(base, cookieOf('ana'), sb.at('proj'), 'n.txt', 'x')).status, 403);

    assert.equal(existsSync(sb.at('proj/n.txt')), false);
  });
});
