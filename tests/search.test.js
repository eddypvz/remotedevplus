import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
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
