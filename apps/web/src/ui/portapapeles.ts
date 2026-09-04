/**
 * Copiar al portapapeles, también sin contexto seguro.
 *
 * `navigator.clipboard` solo existe en HTTPS o localhost. Servido por HTTP —que
 * es como se llega desde la tablet por Tailscale mientras no haya certificado—
 * ni siquiera está definido, así que un `writeText` tira antes de intentar.
 *
 * El respaldo es el truco viejo: un textarea fuera de pantalla, seleccionar y
 * `execCommand('copy')`. Está marcado como obsoleto pero sigue funcionando en
 * todos los navegadores actuales, y es lo único disponible acá.
 */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Puede fallar por permisos aunque el contexto sea seguro; se sigue al respaldo.
  }

  try {
    const caja = document.createElement('textarea');
    caja.value = texto;
    // Fuera de la vista pero seleccionable: `display:none` no se puede copiar.
    caja.setAttribute('readonly', '');
    caja.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(caja);
    caja.select();
    caja.setSelectionRange(0, texto.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(caja);
    return ok;
  } catch {
    return false;
  }
}

/** Si no se puede copiar, conviene decir por qué en vez de fallar en silencio. */
export const puedeCopiar = () => !!navigator.clipboard || !!document.execCommand;
