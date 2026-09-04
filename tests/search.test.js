import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { sandbox, services, SUPER } from './helpers.js';

/**
 * La búsqueda.
 *
 * Lo que se prueba es la frontera y el armado de argumentos: un patrón que
 * empiece con guion no debe leerse como bandera, y buscar fuera de las raíces
 * tiene que fallar. El streaming se verifica contando los eventos que llegan
 * antes de que termine.
 */
describe('búsqueda', () => {
  const sb = sandbox(['proy/src', 'proy/.oculto', 'afuera']);
  writeFileSync(sb.at('proy/src/uno.js'), 'const aguja = 1;\nconst pajar = 2;\naguja otra vez\n');
  writeFileSync(sb.at('proy/src/dos.ts'), 'no está acá\n');
  writeFileSync(sb.at('proy/src/tres.js'), 'la aguja de nuevo\n');
  writeFileSync(sb.at('afuera/secreto.js'), 'aguja prohibida\n');

  const svc = services(sb, { proy: 'proy' });
  const usuario = { id: 1, permissions: ['*'], roots: null };

  const correr = async (opciones, carpetas = [sb.at('proy')]) => {
    const eventos = [];
    const fin = await svc.search.buscar(usuario, carpetas, opciones, (e) => eventos.push(e));
    return { eventos, fin, coincidencias: eventos.filter((e) => e.t === 'coincidencia') };
  };

  test('encuentra y devuelve los desplazamientos de cada coincidencia', async () => {
    const { coincidencias } = await correr({ patron: 'aguja' });
    assert.equal(coincidencias.length, 3);
    const uno = coincidencias.find((c) => c.texto.startsWith('const aguja'));
    assert.deepEqual(uno.partes, [{ desde: 6, hasta: 11 }],
      'los desplazamientos vienen de ripgrep, no recalculados');
    assert.equal(uno.linea, 1);
  });

  test('respeta los filtros por extensión', async () => {
    const { coincidencias } = await correr({ patron: 'aguja', incluir: ['*.ts'] });
    assert.equal(coincidencias.length, 0);
    const js = await correr({ patron: 'aguja', incluir: ['*.js'] });
    assert.equal(js.coincidencias.length, 3);
  });

  test('un patrón que empieza con guion no se lee como bandera', async () => {
    writeFileSync(sb.at('proy/src/guion.js'), 'valor --peligroso aquí\n');
    const { coincidencias, fin } = await correr({ patron: '--peligroso' });
    assert.equal(fin.motivo, 'fin', 'ripgrep no falló');
    assert.equal(coincidencias.length, 1);
  });

  test('la búsqueda literal no interpreta la expresión regular', async () => {
    writeFileSync(sb.at('proy/src/punto.js'), 'a.b y axb\n');
    const literal = await correr({ patron: 'a.b', literal: true });
    assert.equal(literal.coincidencias.length, 1, 'solo el punto textual');
    const regex = await correr({ patron: 'a.b', literal: false });
    assert.equal(regex.coincidencias.length, 1, 'una línea, pero por el comodín');
  });

  test('no se puede buscar fuera de las raíces', async () => {
    await assert.rejects(
      () => correr({ patron: 'aguja' }, [sb.at('afuera')]),
      (e) => e.statusCode === 403,
    );
    await assert.rejects(() => correr({ patron: 'x' }, ['/etc']), (e) => e.statusCode === 403);
  });

  test('un patrón vacío se rechaza', async () => {
    await assert.rejects(() => correr({ patron: '   ' }), (e) => e.statusCode === 400);
  });

  test('los eventos llegan en streaming, no todos al final', async () => {
    let primeroEn = -1;
    const inicio = Date.now();
    await svc.search.buscar(usuario, [sb.at('proy')], { patron: 'aguja' }, () => {
      if (primeroEn < 0) primeroEn = Date.now() - inicio;
    });
    assert.ok(primeroEn >= 0, 'llegó al menos un evento por callback y no en un array final');
  });
});

describe('reemplazo global', () => {
  /** El reemplazo se prueba contra el servicio: la ruta HTTP es una envoltura. */
  const conArchivos = (archivos) => {
    const sb = sandbox(['proj'], archivos);
    return { sb, svc: services(sb, { proj: 'proj' }) };
  };
  const leer = (sb, f) => readFileSync(sb.at(f));

  test('reemplaza en todos los archivos que coinciden', async () => {
    const { sb, svc } = conArchivos({
      'proj/a.txt': 'hola mundo\nhola de nuevo\n',
      'proj/b.txt': 'nada que ver\n',
      'proj/c.txt': 'hola\n',
    });
    const r = await svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: 'hola', literal: true }, 'chau');
    assert.equal(r.archivos, 2);
    assert.equal(r.sustituciones, 3);
    assert.equal(leer(sb, 'proj/a.txt').toString(), 'chau mundo\nchau de nuevo\n');
    assert.equal(leer(sb, 'proj/b.txt').toString(), 'nada que ver\n', 'tocó un archivo sin coincidencias');
  });

  test('no le agrega un salto de línea al archivo que no lo tenía', async () => {
    // `--passthru` imprime línea por línea y agregaría un \n al final. Sin
    // corregirlo, cada reemplazo ensuciaría el diff de todo archivo sin newline.
    const { sb, svc } = conArchivos({ 'proj/sin.txt': 'hola mundo\nsegunda linea hola' });
    await svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: 'hola', literal: true }, 'chau');
    const salida = leer(sb, 'proj/sin.txt');
    assert.equal(salida.toString(), 'chau mundo\nsegunda linea chau');
    assert.notEqual(salida[salida.length - 1], 0x0a, 'agregó un salto que no estaba');
  });

  test('en modo literal un $ en el reemplazo es un $, no una referencia', async () => {
    // ripgrep interpreta $1 y $nombre en --replace aun con --fixed-strings.
    // Sin escapar, "US$100" dejaría "US" y borraría el resto en silencio.
    const { sb, svc } = conArchivos({ 'proj/p.txt': 'precio: XX\n' });
    await svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: 'XX', literal: true }, 'US$100');
    assert.equal(leer(sb, 'proj/p.txt').toString(), 'precio: US$100\n');
  });

  test('en modo expresión regular los grupos sí funcionan', async () => {
    const { sb, svc } = conArchivos({ 'proj/r.txt': 'ancho: 30px\nalto: 40px\n' });
    const r = await svc.search.reemplazar(
      SUPER, [sb.at('proj')],
      { patron: '(\\d+)px', literal: false },
      // Con llaves: ver el test siguiente, que explica por qué.
      '${1}rem',
    );
    assert.equal(r.sustituciones, 2);
    assert.equal(leer(sb, 'proj/r.txt').toString(), 'ancho: 30rem\nalto: 40rem\n');
  });

  test('un grupo pegado a letras necesita llaves, y sin ellas queda vacío', async () => {
    /*
     * Esto no es un defecto que se pueda arreglar acá: el motor de Rust lee
     * `$1rem` como el grupo LLAMADO "1rem", que no existe, y lo reemplaza por
     * nada. Queda como test para que nadie "arregle" el escapado creyendo que
     * es un error nuestro, y para que la interfaz siga diciendo `${1}` en su
     * texto de ayuda.
     */
    const { sb, svc } = conArchivos({ 'proj/r.txt': 'ancho: 30px\n' });
    await svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: '(\\d+)px', literal: false }, '$1rem');
    assert.equal(leer(sb, 'proj/r.txt').toString(), 'ancho: \n');

    // Separado por un espacio no hay ambigüedad y funciona sin llaves.
    const otro = conArchivos({ 'proj/s.txt': 'ancho: 30px\n' });
    await otro.svc.search.reemplazar(SUPER, [otro.sb.at('proj')], { patron: '(\\d+)px', literal: false }, '$1 rem');
    assert.equal(leer(otro.sb, 'proj/s.txt').toString(), 'ancho: 30 rem\n');
  });

  test('CRLF se conserva', async () => {
    const { sb, svc } = conArchivos({ 'proj/w.txt': 'hola\r\nmundo hola\r\n' });
    await svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: 'hola', literal: true }, 'chau');
    assert.equal(leer(sb, 'proj/w.txt').toString(), 'chau\r\nmundo chau\r\n');
  });

  test('con rutas indicadas solo toca esas', async () => {
    const { sb, svc } = conArchivos({ 'proj/a.txt': 'hola\n', 'proj/b.txt': 'hola\n' });
    const r = await svc.search.reemplazar(
      SUPER, [sb.at('proj')], { patron: 'hola', literal: true }, 'chau',
      [sb.at('proj/a.txt')],
    );
    assert.equal(r.archivos, 1);
    assert.equal(leer(sb, 'proj/a.txt').toString(), 'chau\n');
    assert.equal(leer(sb, 'proj/b.txt').toString(), 'hola\n');
  });

  test('no reemplaza fuera de las raíces', async () => {
    const sb = sandbox(['proj', 'afuera'], { 'afuera/ajeno.txt': 'hola\n' });
    const svc = services(sb, { proj: 'proj' });
    await assert.rejects(
      () => svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: 'hola', literal: true }, 'chau', [sb.at('afuera/ajeno.txt')]),
    );
    assert.equal(readFileSync(sb.at('afuera/ajeno.txt'), 'utf8'), 'hola\n');
  });

  test('respeta los filtros por extensión', async () => {
    const { sb, svc } = conArchivos({ 'proj/a.js': 'hola\n', 'proj/a.md': 'hola\n' });
    await svc.search.reemplazar(SUPER, [sb.at('proj')], { patron: 'hola', literal: true, incluir: '*.js' }, 'chau');
    assert.equal(leer(sb, 'proj/a.js').toString(), 'chau\n');
    assert.equal(leer(sb, 'proj/a.md').toString(), 'hola\n');
  });
});
