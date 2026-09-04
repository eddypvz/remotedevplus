import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { httpError } from '../paths.js';

/**
 * Dónde está ripgrep.
 *
 * Se prefiere el que viene con el proyecto: así clonar y correr alcanza, igual
 * que con node-pty. El del sistema queda como respaldo por si alguien quiere
 * usar su propia versión, y `--rg-bin` gana sobre todo.
 *
 * Ojo con el `rg` de la shell en algunos entornos: puede ser una función que
 * enruta a otro programa, no un ejecutable. `spawn` no ve funciones de shell,
 * así que un `rg` que anda en la terminal no garantiza que ande acá.
 */
function resolverRipgrep(preferido) {
  if (preferido && existsSync(preferido)) return preferido;
  try {
    // require desde un módulo ESM: el paquete no expone exports de ESM.
    const { rgPath } = createRequire(import.meta.url)('@vscode/ripgrep');
    if (rgPath && existsSync(rgPath)) return rgPath;
  } catch {
    /* no está empaquetado en esta instalación */
  }
  return 'rg';
}

/**
 * Búsqueda global con ripgrep.
 *
 * Los resultados van en streaming y no en una respuesta armada: en un
 * repositorio grande la primera coincidencia aparece en milisegundos y la
 * última puede tardar segundos, y esperar a tenerlas todas para mostrar la
 * primera es tiempo regalado.
 *
 * Se usa `--json` en vez de la salida de texto porque trae los desplazamientos
 * exactos de cada coincidencia dentro de la línea: resaltarlas recalculándolas
 * en el cliente se rompe con acentos, tabulaciones y expresiones regulares.
 */

const MAX_RESULTADOS = 2000;
const MAX_POR_ARCHIVO = 60;

export function createSearch(cfg, guard, audit) {
  const RG = resolverRipgrep(cfg.rgBin);

  /**
   * Los argumentos se arman desde valores validados, nunca concatenando. El
   * patrón va después de `-e` y las rutas después de `--`, para que un patrón
   * que empiece con guion no se lea como bandera.
   */
  function argumentos(opciones, rutas) {
    const args = ['--json', '--line-number', '--column'];

    if (opciones.literal) args.push('--fixed-strings');
    if (opciones.palabraCompleta) args.push('--word-regexp');
    args.push(opciones.sensible ? '--case-sensitive' : '--smart-case');
    if (opciones.ocultos) args.push('--hidden');
    if (opciones.sinIgnorar) args.push('--no-ignore');

    // .git siempre fuera: buscar dentro de los objetos de git no le sirve a nadie.
    args.push('--glob', '!.git/**');
    for (const g of opciones.incluir) args.push('--glob', g);
    for (const g of opciones.excluir) args.push('--glob', `!${g}`);

    args.push('--max-count', String(MAX_POR_ARCHIVO));
    args.push('-e', opciones.patron);
    args.push('--', ...rutas);
    return args;
  }

  function limpiar(entrada) {
    const o = entrada ?? {};
    const patron = String(o.patron ?? '').trim();
    if (!patron) throw httpError(400, 'Falta qué buscar');
    if (patron.length > 500) throw httpError(400, 'El patrón es demasiado largo');
    const globs = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')) 
      .map((g) => String(g).trim())
      .filter((g) => g && g.length < 200)
      .slice(0, 20);
    return {
      patron,
      literal: o.literal !== false,
      sensible: !!o.sensible,
      palabraCompleta: !!o.palabraCompleta,
      ocultos: !!o.ocultos,
      sinIgnorar: !!o.sinIgnorar,
      incluir: globs(o.incluir),
      excluir: globs(o.excluir),
    };
  }

  return {
    /**
     * Emite eventos a medida que llegan. `onEvento` recibe objetos ya
     * normalizados; el que llama decide cómo mandarlos al cliente.
     */
    async buscar(user, carpetas, entrada, onEvento, signal) {
      const opciones = limpiar(entrada);
      const pedidas = Array.isArray(carpetas) ? carpetas : [carpetas];
      if (!pedidas.length) throw httpError(400, 'Falta dónde buscar');

      const rutas = [];
      for (const c of pedidas) {
        rutas.push((await guard.resolvePath(user, c, { mustExist: true })).path);
      }

      audit.log(user.id, 'search', { patron: opciones.patron, rutas });

      return new Promise((resolve) => {
        const hijo = spawn(RG, argumentos(opciones, rutas), {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let total = 0;
        let archivos = 0;
        let resto = '';
        let cortado = false;
        let errores = '';

        const terminar = (motivo) => {
          if (hijo.exitCode === null && !hijo.killed) hijo.kill('SIGTERM');
          resolve({ total, archivos, cortado, motivo, errores: errores.trim() });
        };

        // Cancelar de verdad: si el usuario sigue escribiendo, la búsqueda
        // anterior tiene que morir, no seguir gastando disco.
        signal?.addEventListener('abort', () => terminar('cancelada'), { once: true });

        hijo.stderr.on('data', (d) => { errores += d.toString().slice(0, 2000); });

        hijo.stdout.on('data', (trozo) => {
          resto += trozo.toString();
          const lineas = resto.split('\n');
          resto = lineas.pop() ?? '';

          for (const linea of lineas) {
            if (!linea) continue;
            let d;
            try { d = JSON.parse(linea); } catch { continue; }

            if (d.type === 'begin') {
              archivos++;
              onEvento({ t: 'archivo', ruta: d.data.path?.text ?? '' });
            } else if (d.type === 'match') {
              if (total >= MAX_RESULTADOS) {
                cortado = true;
                terminar('demasiados');
                return;
              }
              total++;
              const m = d.data;
              onEvento({
                t: 'coincidencia',
                ruta: m.path?.text ?? '',
                linea: m.line_number,
                // El texto se recorta acá: una línea minificada de 200KB no
                // aporta nada y tiraría abajo el navegador.
                texto: (m.lines?.text ?? '').replace(/\n$/, '').slice(0, 400),
                partes: (m.submatches ?? []).map((s) => ({ desde: s.start, hasta: s.end })),
              });
            }
          }
        });

        hijo.on('error', (err) => {
          errores = err.code === 'ENOENT'
            ? 'No se encontró ripgrep. Debería venir con el proyecto: ejecute npm install, '
              + 'o instalalo en el sistema y apuntá a él con --rg-bin'
            : err.message;
          terminar('error');
        });

        // Código 1 en ripgrep significa "sin coincidencias", no un fallo.
        hijo.on('close', (code) => terminar(code === 0 || code === 1 ? 'fin' : 'error'));
      });
    },
  };
}
