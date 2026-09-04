import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown a HTML, saneado.
 *
 * El saneado no es opcional aunque el texto venga de Claude: los resultados de
 * herramientas traen contenido de archivos del proyecto, y un archivo puede
 * contener cualquier cosa. Sin DOMPurify, leer un HTML del repo ejecutaría su
 * script dentro de la aplicación.
 */
marked.setOptions({ gfm: true, breaks: true });

/** Se abren en pestaña nueva: un enlace no debe sacarte de la conversación. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(texto: string): string {
  const crudo = marked.parse(texto ?? '', { async: false }) as string;
  return DOMPurify.sanitize(crudo, {
    // Sin formularios, iframes ni multimedia: nada de eso aparece en una
    // respuesta legítima y todo amplía la superficie sin dar nada a cambio.
    FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed', 'style', 'video', 'audio'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  });
}
