import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * El markdown de la conversación se sanea antes de inyectarse.
 *
 * No es paranoia sobre lo que escribe Claude: los resultados de herramientas
 * traen contenido de archivos del proyecto. Un README con un <script> dentro se
 * ejecutaría en la aplicación si esto fallara.
 */
describe('saneado del markdown', () => {
  // El módulo del frontend importa dompurify, que necesita un DOM. Se le da uno.
  const dom = new JSDOM('');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  test('deja pasar el markdown legítimo', async () => {
    const { renderMarkdown } = await import('../apps/web/src/ui/markdown.ts');
    const html = renderMarkdown('## Título\n\nTexto con `código` y **negrita**.\n\n- uno\n- dos');
    assert.match(html, /<h2[^>]*>Título<\/h2>/);
    assert.match(html, /<code>código<\/code>/);
    assert.match(html, /<strong>negrita<\/strong>/);
    assert.match(html, /<li>uno<\/li>/);
  });

  test('bloquea lo peligroso', async () => {
    const { renderMarkdown } = await import('../apps/web/src/ui/markdown.ts');
    const casos = [
      ['script suelto', '<script>alert(1)</script>'],
      ['imagen con onerror', '<img src=x onerror="alert(1)">'],
      ['iframe', '<iframe src="https://evil.example"></iframe>'],
      ['enlace javascript:', '[click](javascript:alert(1))'],
      ['svg con onload', '<svg onload="alert(1)"></svg>'],
      ['formulario', '<form action="/x"><input name="p"></form>'],
      ['estilo inyectado', '<div style="position:fixed;inset:0">tapa todo</div>'],
    ];
    for (const [nombre, entrada] of casos) {
      const html = renderMarkdown(entrada);
      assert.ok(!/<script/i.test(html), `${nombre}: quedó un <script>`);
      assert.ok(!/on\w+\s*=/i.test(html), `${nombre}: quedó un manejador de eventos`);
      assert.ok(!/javascript:/i.test(html), `${nombre}: quedó un javascript:`);
      assert.ok(!/<iframe|<form|<input|<object|<embed/i.test(html), `${nombre}: quedó una etiqueta prohibida`);
      assert.ok(!/style\s*=/i.test(html), `${nombre}: quedó un style inline`);
    }
  });

  test('un archivo no corta las líneas donde el autor las envolvió', async () => {
    const { renderMarkdown } = await import('../apps/web/src/ui/markdown.ts');
    const parrafo = 'Una frase larga que el autor\nenvolvió a ochenta columnas\ncomo se hace en un README.';

    // Por defecto, sin saltos duros: es un párrafo, no tres líneas. Con
    // `breaks` activo un README se vería dentado, con un corte por cada línea
    // del archivo fuente.
    const documento = renderMarkdown(parrafo);
    assert.equal(documento.includes('<br'), false, 'metió saltos donde no los hay');

    // En el chat sí: quien escribe un mensaje espera que sus saltos se vean.
    const mensaje = renderMarkdown(parrafo, { duros: true });
    assert.ok(mensaje.includes('<br'), 'perdió los saltos del mensaje');
  });

  test('los enlaces se abren afuera', async () => {
    const { renderMarkdown } = await import('../apps/web/src/ui/markdown.ts');
    const html = renderMarkdown('[docs](https://example.com)');
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });
});
