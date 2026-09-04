import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
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
/** Tope de archivos que un solo reemplazo puede tocar. */
const MAX_ARCHIVOS_REEMPLAZO = 500;

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
              + 'o instálelo en el sistema y apunte a él con --rg-bin'
            : err.message;
          terminar('error');
        });

        // Código 1 en ripgrep significa "sin coincidencias", no un fallo.
        hijo.on('close', (code) => terminar(code === 0 || code === 1 ? 'fin' : 'error'));
      });
    },

    /**
     * Reemplaza en todos los archivos que coinciden.
     *
     * Lo hace **ripgrep**, con `--passthru --replace`, y no una expresión
     * regular de JavaScript. Es la única forma de que lo que se reemplaza sea
     * exactamente lo que se mostró: el motor de Rust y el de JavaScript no
     * coinciden en clases Unicode, en `\b` ni en los cuantificadores perezosos,
     * y reemplazar con un motor distinto del que buscó es cómo se corrompe un
     * proyecto en silencio.
     *
     * `rutas` limita la operación a los archivos indicados; sin ella se
     * reemplaza en todo lo que coincida.
     */
    async reemplazar(user, carpetas, entrada, reemplazo, rutas = null) {
      const opciones = limpiar(entrada);
      if (typeof reemplazo !== 'string') throw httpError(400, 'Falta por qué reemplazar');
      if (reemplazo.length > 2000) throw httpError(400, 'El reemplazo es demasiado largo');

      // Qué archivos tocar: los que coinciden, o los que pidieron.
      const objetivo = new Set();
      if (Array.isArray(rutas) && rutas.length) {
        for (const ruta of rutas.slice(0, MAX_ARCHIVOS_REEMPLAZO)) {
          objetivo.add((await guard.resolvePath(user, ruta, { mustExist: true })).path);
        }
      } else {
        await this.buscar(user, carpetas, entrada, (ev) => {
          if (ev.t === 'archivo' && objetivo.size < MAX_ARCHIVOS_REEMPLAZO) objetivo.add(ev.ruta);
        });
      }
      if (!objetivo.size) return { archivos: 0, sustituciones: 0, fallos: [] };

      /*
       * En modo literal se escapan los `$` del reemplazo.
       *
       * `--replace` siempre interpreta `$1` y `$nombre` como referencias, aun
       * con `--fixed-strings`. Sin escapar, reemplazar por `US$100` dejaría
       * `US` y borraría el resto sin decir nada.
       */
      const repl = opciones.literal ? reemplazo.replace(/\$/g, '$$$$') : reemplazo;

      let sustituciones = 0;
      let archivos = 0;
      const fallos = [];

      for (const ruta of objetivo) {
        try {
          const antes = await readFile(ruta);
          let nuevo = await pasarPorRipgrep(RG, opciones, repl, ruta);
          if (nuevo === null) continue;
          /*
           * `--passthru` imprime línea por línea, así que le agrega un salto
           * final al archivo que no lo tenía. Sin esto, buscar y reemplazar
           * modificaría en silencio cada archivo sin newline al final —y en un
           * repositorio eso aparece como un cambio espurio en el diff.
           */
          const teniaSalto = antes.length > 0 && antes[antes.length - 1] === 0x0a;
          if (!teniaSalto && nuevo.length > 0 && nuevo[nuevo.length - 1] === 0x0a) {
            nuevo = nuevo.subarray(0, nuevo.length - 1);
          }
          if (antes.equals(nuevo)) continue;
          // Se cuenta ANTES de escribir: después las coincidencias ya no están,
          // y si el reemplazo contiene el patrón el número saldría al revés.
          const cuantas = await contar(RG, opciones, ruta);
          await writeFile(ruta, nuevo);
          archivos++;
          sustituciones += cuantas;
        } catch (e) {
          fallos.push({ ruta, motivo: e?.message || 'no se pudo reescribir' });
        }
      }

      audit.log(user.id, 'search.replace', {
        patron: opciones.patron, reemplazo, archivos, sustituciones,
      });
      return { archivos, sustituciones, fallos };
    },
  };

  /**
   * Corre ripgrep sobre un archivo y devuelve su contenido ya reemplazado.
   *
   * `--passthru` imprime también las líneas que no coinciden, así la salida es
   * el archivo entero. Devuelve `null` si ripgrep no produjo nada útil —un
   * binario, por ejemplo—, y ahí el archivo se deja como estaba.
   */
  function pasarPorRipgrep(RG, opciones, repl, ruta) {
    const args = ['--passthru', '--no-line-number', '--no-filename', '--color', 'never'];
    if (opciones.literal) args.push('--fixed-strings');
    if (opciones.palabraCompleta) args.push('--word-regexp');
    args.push(opciones.sensible ? '--case-sensitive' : '--smart-case');
    args.push('--replace', repl, '-e', opciones.patron, '--', ruta);

    return new Promise((resolve, reject) => {
      const hijo = spawn(RG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const trozos = [];
      let err = '';
      hijo.stdout.on('data', (d) => trozos.push(d));
      hijo.stderr.on('data', (d) => { err += d.toString().slice(0, 500); });
      hijo.on('error', reject);
      hijo.on('close', (code) => {
        if (code !== 0 && code !== 1) return reject(new Error(err.trim() || 'ripgrep falló'));
        resolve(trozos.length ? Buffer.concat(trozos) : null);
      });
    });
  }

  /** Cuántas coincidencias había en un archivo antes de tocarlo. */
  function contar(RG, opciones, ruta) {
    const args = ['--count-matches', '--no-filename'];
    if (opciones.literal) args.push('--fixed-strings');
    if (opciones.palabraCompleta) args.push('--word-regexp');
    args.push(opciones.sensible ? '--case-sensitive' : '--smart-case');
    args.push('-e', opciones.patron, '--', ruta);
    return new Promise((resolve) => {
      const hijo = spawn(RG, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let salida = '';
      hijo.stdout.on('data', (d) => { salida += d; });
      hijo.on('error', () => resolve(0));
      hijo.on('close', () => resolve(
        salida.split('\n').filter(Boolean).reduce((n, l) => n + (parseInt(l, 10) || 0), 0),
      ));
    });
  }
}
