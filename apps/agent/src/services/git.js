import { join } from 'node:path';
import { httpError } from '../paths.js';

/**
 * Git, en formato de máquina.
 *
 * Todo sale de `--porcelain=v2`, `for-each-ref` y `log --format`, nunca de
 * parsear la salida para humanos: esa cambia entre versiones y con la
 * configuración del usuario. Los comandos se lanzan por `Host.exec`, que no
 * invoca un shell, así que ningún argumento puede convertirse en otro comando.
 */

/** Separadores de control: no aparecen en mensajes ni en nombres de archivo. */
const SEP = '\x1f';
const FIN = '\x1e';

const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%at', '%D', '%s'].join(SEP) + FIN;

/**
 * Asigna a cada commit su carril en el árbol.
 *
 * Es el corazón del gráfico y por eso vive en el agente: es O(n) y hacerlo acá
 * evita mandarle el algoritmo al navegador para que lo recorra en cada pintado.
 *
 * La idea: se llevan "carriles abiertos", cada uno esperando un hash. Un commit
 * ocupa el carril que lo esperaba —o abre uno nuevo si nadie lo esperaba, que
 * es una punta de rama—. Después su primer padre continúa en ese mismo carril,
 * y los demás padres abren carriles nuevos o se enganchan a uno que ya los
 * esperaba, que es lo que dibuja una fusión.
 */
export function asignarCarriles(commits) {
  /** @type {(string|null)[]} carril → hash que espera */
  const carriles = [];
  const salida = [];

  const buscar = (hash) => carriles.findIndex((h) => h === hash);
  const libre = () => {
    const i = carriles.indexOf(null);
    return i >= 0 ? i : carriles.length;
  };

  for (const c of commits) {
    let carril = buscar(c.hash);
    // Si nadie esperaba a este commit, es una punta: no le baja ninguna línea.
    // El cliente lo necesita para no dibujar un trazo que sale de la nada, y
    // acá se sabe sin costo — deducirlo después obligaría a recorrer el grafo.
    const entraArriba = carril >= 0;
    if (carril < 0) {
      carril = libre();
      carriles[carril] = c.hash;
    }
    // Los otros carriles que esperaban a este commit también convergen acá.
    const entrantes = [];
    for (let i = 0; i < carriles.length; i++) {
      if (i !== carril && carriles[i] === c.hash) {
        entrantes.push(i);
        carriles[i] = null;
      }
    }

    // Las líneas que pasan de largo por esta fila, para poder dibujarlas.
    const cruzando = [];
    for (let i = 0; i < carriles.length; i++) {
      if (i !== carril && carriles[i]) cruzando.push(i);
    }

    const salidas = [];
    if (c.parents.length === 0) {
      carriles[carril] = null;
    } else {
      // El primer padre sigue derecho: así una rama se ve como una línea recta.
      carriles[carril] = c.parents[0];
      salidas.push({ carril, hash: c.parents[0] });
      for (const padre of c.parents.slice(1)) {
        const ya = buscar(padre);
        const destino = ya >= 0 ? ya : libre();
        carriles[destino] = padre;
        salidas.push({ carril: destino, hash: padre });
      }
    }

    // Se recortan los carriles vacíos del final para que el ancho no crezca sin volver.
    while (carriles.length && carriles[carriles.length - 1] === null) carriles.pop();

    salida.push({ ...c, carril, entraArriba, entrantes, cruzando, salidas, ancho: carriles.length });
  }
  return salida;
}

/**
 * Una URL de repositorio que se puede pasar a `git clone` sin peligro.
 *
 * No es paranoia: `git clone` acepta transportes que ejecutan comandos. Con
 * `ext::sh -c ...` clonar es ejecutar, y una URL que empieza con guion la lee
 * como una bandera —`--upload-pack=` corre un binario arbitrario. Por eso acá
 * hay una lista blanca de formas, y en la línea de comandos va `--` antes de la
 * URL para que ni siquiera un guion que se escape pueda leerse como opción.
 */
export function urlDeRepoValida(url) {
const u = String(url ?? '').trim();
if (!u || u.length > 500) return false;
if (u.startsWith('-')) return false;
// `scp` de toda la vida: git@github.com:usuario/repo.git
if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~\-/]+$/.test(u)) return true;
try {
  const p = new URL(u);
  return ['https:', 'http:', 'ssh:', 'git:'].includes(p.protocol);
} catch {
  return false;
}
}

/**
 * Un nombre de carpeta, no una ruta.
 *
 * El destino se arma como `<carpeta elegida>/<nombre>`, así que una barra o un
 * `..` acá crearían el clon en otro lado. `paths.js` lo detendría igual, pero
 * fallar acá dice por qué.
 */
export function nombreDeCarpetaValido(nombre) {
return typeof nombre === 'string'
  && nombre.length > 0 && nombre.length <= 255
  && !nombre.includes('/') && !nombre.includes('\\')
  && nombre !== '.' && nombre !== '..'
  && !nombre.includes('\0');
}


export function createGit(hosts, guard, audit) {
  /** Resuelve el repositorio y comprueba que lo sea, dentro de las raíces. */
  async function repo(user, cwd) {
    const r = await guard.resolvePath(user, cwd, { mustExist: true });
    const host = hosts.get(r.host);
    const { code, stdout } = await host.exec('git', ['rev-parse', '--show-toplevel'], { cwd: r.path });
    if (code !== 0) throw httpError(400, 'Esa carpeta no es un repositorio de git');
    const raiz = stdout.trim();
    // El toplevel puede estar por encima de la carpeta pedida; tiene que seguir
    // dentro de las raíces del usuario.
    const dentro = await guard.resolvePath(user, raiz, { mustExist: true });
    return { host, path: dentro.path };
  }

  async function git(r, args) {
    const { code, stdout, stderr } = await r.host.exec('git', args, { cwd: r.path });
    if (code !== 0) throw httpError(400, stderr.trim() || `git ${args[0]} falló`);
    return stdout;
  }

  /**
   * Lo que sale a la red.
   *
   * Nada de pedir credenciales por consola: no hay nadie del otro lado para
   * contestarlas, y sin estas variables git se queda esperando una entrada que
   * nunca llega. Con ellas falla enseguida y se puede decir por qué.
   *
   * La autenticación va por la llave SSH del usuario que corre el agente, que
   * es la misma que usa la terminal.
   */
  async function gitRed(r, args, timeoutMs = 90_000) {
    const { code, stdout, stderr } = await r.host.exec('git', args, {
      cwd: r.path,
      timeoutMs,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
      },
    });
    const texto = `${stdout}\n${stderr}`.trim();
    if (code === 124) throw httpError(504, 'El remoto no respondió a tiempo.');
    if (code !== 0) {
      const pista = /Permission denied|could not read Username|Authentication failed/i.test(texto)
        ? '\n\nEl agente autentica con la llave SSH de su usuario del sistema; '
          + 'revise que tenga acceso al remoto.'
        : '';
      throw httpError(400, (texto || `git ${args[0]} falló`) + pista);
    }
    return texto;
  }

  /**
   * Qué operación de git quedó a medias, mirando los archivos de control.
   *
   * Se leen del disco y no de la salida de `status` porque porcelain v2 no lo
   * dice: hay que deducirlo, y deducirlo mal significa ofrecer
   * "rebase --continue" en medio de un merge.
   */
  async function operacionEnCurso(r) {
    const gitDir = join(r.path, '.git');
    const hay = async (p) => !!(await r.host.stat(join(gitDir, p)));
    if (await hay('rebase-merge') || await hay('rebase-apply')) return 'rebase';
    if (await hay('MERGE_HEAD')) return 'merge';
    if (await hay('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await hay('REVERT_HEAD')) return 'revert';
    return null;
  }

/** Convierte los códigos XY de porcelain v2 en algo con nombre. */
  function estadoDe(xy) {
    const letra = (c) => ({ M: 'modificado', A: 'agregado', D: 'borrado', R: 'renombrado', C: 'copiado', T: 'tipo' }[c]);
    return { staged: letra(xy[0]) ?? null, arbol: letra(xy[1]) ?? null };
  }

  return {
    async estado(user, cwd) {
      const r = await repo(user, cwd);
      const salida = await git(r, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);

      const info = { rama: null, upstream: null, adelante: 0, atras: 0, oid: null };
      const archivos = [];

      for (const linea of salida.split('\n')) {
        if (!linea) continue;
        if (linea.startsWith('# branch.head')) info.rama = linea.slice(14).trim();
        else if (linea.startsWith('# branch.upstream')) info.upstream = linea.slice(18).trim();
        else if (linea.startsWith('# branch.oid')) info.oid = linea.slice(13).trim();
        else if (linea.startsWith('# branch.ab')) {
          const m = linea.match(/\+(\d+) -(\d+)/);
          if (m) { info.adelante = +m[1]; info.atras = +m[2]; }
        } else if (linea[0] === '1') {
          const p = linea.split(' ');
          archivos.push({ ruta: p.slice(8).join(' '), origen: null, ...estadoDe(p[1]), conflicto: false });
        } else if (linea[0] === '2') {
          // Renombrado o copiado: la ruta nueva y la vieja van separadas por tab.
          const p = linea.split(' ');
          const partes = linea.split('\t');
          const ruta = partes[0].slice(partes[0].lastIndexOf(' ') + 1);
          archivos.push({ ruta, origen: partes[1] ?? null, ...estadoDe(p[1]), conflicto: false });
        } else if (linea[0] === 'u') {
          const p = linea.split(' ');
          archivos.push({ ruta: p.slice(10).join(' '), staged: null, arbol: 'conflicto', conflicto: true });
        } else if (linea[0] === '?') {
          archivos.push({ ruta: linea.slice(2), staged: null, arbol: 'nuevo', conflicto: false, sinRastrear: true });
        }
      }

      return {
        ...info,
        // Qué operación quedó a medias. Sin esto la interfaz no puede ofrecer
        // "continuar" ni "abortar", que es lo único que se quiere hacer cuando
        // un merge o un rebase se para en un conflicto.
        operacion: await operacionEnCurso(r),
        // `branch.head` devuelve el literal "(detached)" cuando no hay rama.
        // Se traduce a una bandera para que la interfaz no compare cadenas.
        desprendido: info.rama === '(detached)',
        oidCorto: (info.oid ?? '').slice(0, 7),
        // Tres cubetas, que es como se piensa el trabajo: lo que va al commit,
        // lo que todavía no, y lo que git no conoce.
        preparados: archivos.filter((a) => a.staged && !a.conflicto),
        cambiados: archivos.filter((a) => a.arbol && !a.conflicto && !a.sinRastrear),
        sinRastrear: archivos.filter((a) => a.sinRastrear),
        conflictos: archivos.filter((a) => a.conflicto),
      };
    },

    async grafo(user, cwd, limite = 200) {
      const r = await repo(user, cwd);
      const salida = await git(r, [
        'log', '--all', '--date-order', `--max-count=${Math.min(limite, 1000)}`,
        `--format=${LOG_FORMAT}`,
      ]);

      const commits = salida.split(FIN)
        .map((bloque) => bloque.replace(/^\n/, ''))
        .filter(Boolean)
        .map((bloque) => {
          const [hash, corto, padres, autor, correo, fecha, refs, asunto] = bloque.split(SEP);
          return {
            hash, corto, autor, correo,
            fecha: Number(fecha) * 1000,
            asunto,
            parents: padres ? padres.split(' ').filter(Boolean) : [],
            refs: refs ? refs.split(', ').map((x) => x.trim()).filter(Boolean) : [],
          };
        });

      return { commits: asignarCarriles(commits) };
    },

    async ramas(user, cwd) {
      const r = await repo(user, cwd);
      const formato = [
        '%(refname:short)', '%(refname)', '%(upstream:short)', '%(upstream:track)',
        '%(objectname:short)', '%(committerdate:unix)', '%(HEAD)',
      ].join(SEP);
      const salida = await git(r, [
        'for-each-ref', '--sort=-committerdate', `--format=${formato}`,
        'refs/heads', 'refs/remotes', 'refs/tags',
      ]);
      return {
        ramas: salida.split('\n').filter(Boolean).map((l) => {
          const [nombre, ref, upstream, track, oid, fecha, head] = l.split(SEP);
          const adelante = track?.match(/ahead (\d+)/);
          const atras = track?.match(/behind (\d+)/);
          return {
            nombre, ref, upstream: upstream || null,
            adelante: adelante ? +adelante[1] : 0,
            atras: atras ? +atras[1] : 0,
            oid, fecha: Number(fecha) * 1000,
            actual: head === '*',
            tipo: ref.startsWith('refs/heads/') ? 'local'
              : ref.startsWith('refs/tags/') ? 'etiqueta' : 'remota',
          };
        }),
      };
    },

    /**
     * El stash, con su contenido.
     *
     * `stash list` a secas solo da el mensaje. Se pide aparte qué archivos toca
     * cada entrada, porque lo que uno necesita saber antes de aplicar uno es
     * qué va a tocar, no cómo se llama.
     */
    async stash(user, cwd) {
      const r = await repo(user, cwd);
      const formato = ['%gd', '%ct', '%gs', '%H'].join(SEP);
      const salida = await git(r, ['stash', 'list', `--format=${formato}`]);
      const entradas = [];
      for (const l of salida.split('\n').filter(Boolean)) {
        const [ref, fecha, mensaje, hash] = l.split(SEP);
        const archivos = await git(r, ['stash', 'show', '--name-only', '--include-untracked', ref])
          .catch(() => '');
        entradas.push({
          ref, hash, fecha: Number(fecha) * 1000,
          mensaje: mensaje.replace(/^(WIP on|On) [^:]+: /, ''),
          rama: mensaje.match(/^(?:WIP on|On) ([^:]+):/)?.[1] ?? null,
          archivos: archivos.split('\n').filter(Boolean),
        });
      }
      return { entradas };
    },

    /**
     * Qué tocó un commit.
     *
     * `--name-status` y `--numstat` no se combinan —gana uno— así que se piden
     * por separado y se unen por ruta: una da la letra del cambio y la otra
     * cuántas líneas entraron y salieron.
     *
     * En una fusión, `diff-tree` sin banderas no muestra nada. Con
     * `--first-parent` se ve lo que la fusión trajo a la rama, que es lo que
     * uno quiere saber al mirarla.
     */
    async detalleCommit(user, cwd, hash) {
      const r = await repo(user, cwd);
      if (!/^[0-9a-f]{7,40}$/i.test(String(hash))) throw httpError(400, 'Hash inválido');

      const meta = await git(r, [
        'show', '--no-patch',
        `--format=%H${SEP}%h${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%cn${SEP}%ct${SEP}%s${SEP}%b`,
        hash,
      ]);
      const [hh, corto, padres, autor, correo, fecha, comitero, fechaCommit, asunto, cuerpo] = meta.split(SEP);
      const esFusion = (padres ?? '').trim().split(' ').filter(Boolean).length > 1;

      const base = ['diff-tree', '-r', '-M', '--no-commit-id'];
      if (esFusion) base.push('-m', '--first-parent');

      const [estados, numeros] = await Promise.all([
        git(r, [...base, '--name-status', hash]),
        git(r, [...base, '--numstat', hash]),
      ]);

      const LETRA = { M: 'modificado', A: 'agregado', D: 'borrado', R: 'renombrado', C: 'copiado', T: 'tipo' };
      const archivos = new Map();
      for (const l of estados.split('\n').filter(Boolean)) {
        const campos = l.split('\t');
        const letra = campos[0][0];
        // En un renombrado vienen origen y destino; interesa el destino.
        const ruta = campos[campos.length - 1];
        archivos.set(ruta, {
          ruta,
          origen: letra === 'R' || letra === 'C' ? campos[1] : null,
          estado: LETRA[letra] ?? 'modificado',
          mas: 0, menos: 0, binario: false,
        });
      }
      for (const l of numeros.split('\n').filter(Boolean)) {
        const [mas, menos, ...resto] = l.split('\t');
        const ruta = resto[resto.length - 1];
        const a = archivos.get(ruta);
        if (!a) continue;
        // Un binario reporta "-" en vez de un número.
        a.binario = mas === '-';
        a.mas = a.binario ? 0 : Number(mas) || 0;
        a.menos = a.binario ? 0 : Number(menos) || 0;
      }

      const lista = [...archivos.values()];
      return {
        hash: hh, corto,
        parents: (padres ?? '').trim().split(' ').filter(Boolean),
        autor, correo, fecha: Number(fecha) * 1000,
        comitero, fechaCommit: Number(fechaCommit) * 1000,
        asunto, cuerpo: (cuerpo ?? '').trim(),
        esFusion,
        archivos: lista,
        total: {
          archivos: lista.length,
          mas: lista.reduce((n, a) => n + a.mas, 0),
          menos: lista.reduce((n, a) => n + a.menos, 0),
        },
      };
    },

    /** El diff de un archivo tal como quedó en ese commit. */
    async diffCommit(user, cwd, hash, ruta) {
      const r = await repo(user, cwd);
      if (!/^[0-9a-f]{7,40}$/i.test(String(hash))) throw httpError(400, 'Hash inválido');
      const texto = await git(r, [
        'show', '--no-color', '--format=', '-M', '--first-parent', hash, '--', ruta,
      ]).catch(() => '');
      return { diff: texto };
    },

    async diff(user, cwd, ruta, preparado) {
      const r = await repo(user, cwd);
      const args = ['diff', '--no-color', '--no-ext-diff'];
      if (preparado) args.push('--cached');
      args.push('--', ruta);
      let texto = await git(r, args);
      if (!texto.trim() && !preparado) {
        // Un archivo sin rastrear no tiene diff; se muestra como todo agregado.
        texto = await git(r, ['diff', '--no-color', '--no-index', '/dev/null', ruta]).catch(() => '');
      }
      return { diff: texto };
    },

    async preparar(user, cwd, rutas, quitar) {
      const r = await repo(user, cwd);
      if (!Array.isArray(rutas) || !rutas.length) throw httpError(400, 'No se indicó ningún archivo');
      // `--` separa rutas de opciones: sin eso un archivo llamado "-f" sería una bandera.
      await git(r, quitar ? ['restore', '--staged', '--', ...rutas] : ['add', '--', ...rutas]);
      audit.log(user.id, quitar ? 'git.unstage' : 'git.stage', { cwd: r.path, n: rutas.length });
      return this.estado(user, cwd);
    },

    async descartar(user, cwd, rutas) {
      const r = await repo(user, cwd);
      if (!Array.isArray(rutas) || !rutas.length) throw httpError(400, 'No se indicó ningún archivo');
      // Irreversible: queda en la auditoría con las rutas exactas.
      audit.log(user.id, 'git.discard', { cwd: r.path, rutas });
      await git(r, ['restore', '--worktree', '--', ...rutas]).catch(() => {});
      await git(r, ['clean', '-fd', '--', ...rutas]).catch(() => {});
      return this.estado(user, cwd);
    },

    /**
     * Resuelve conflictos quedándose con un lado, o los marca como resueltos.
     *
     * `mio` y `suyo` son `--ours` y `--theirs`, y significan lo contrario según
     * la operación: en un rebase "mío" es el commit que se está aplicando, no
     * la rama en la que se estaba. Por eso la interfaz los nombra con lo que
     * git llama a cada lado y no con "el mío" a secas.
     *
     * En los tres casos termina con `add`: en git, resolver un conflicto ES
     * ponerlo en el índice.
     */
    async resolver(user, cwd, rutas, lado) {
      const r = await repo(user, cwd);
      if (!Array.isArray(rutas) || !rutas.length) throw httpError(400, 'No se indicó ningún archivo');
      if (!['ours', 'theirs', 'manual'].includes(lado)) throw httpError(400, 'Lado desconocido');
      if (lado !== 'manual') {
        await git(r, ['checkout', `--${lado}`, '--', ...rutas]);
      }
      await git(r, ['add', '--', ...rutas]);
      audit.log(user.id, 'git.resolve', { cwd: r.path, lado, rutas });
      return this.estado(user, cwd);
    },

    /**
     * Continúa o aborta la operación a medias.
     *
     * Se pasa `GIT_EDITOR=true` porque `rebase --continue` abre un editor para
     * el mensaje del commit, y acá no hay nadie que lo cierre: sin esto el
     * proceso queda colgado hasta el timeout.
     */
    async seguir(user, cwd, accion) {
      const r = await repo(user, cwd);
      if (!['continuar', 'abortar'].includes(accion)) throw httpError(400, 'Acción desconocida');
      const op = await operacionEnCurso(r);
      if (!op) throw httpError(400, 'No hay ninguna operación a medias');

      const bandera = accion === 'continuar' ? '--continue' : '--abort';
      const comando = op === 'cherry-pick' ? 'cherry-pick' : op === 'revert' ? 'revert' : op;
      const { code, stdout, stderr } = await r.host.exec('git', [comando, bandera], {
        cwd: r.path,
        env: { GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' },
        timeoutMs: 60_000,
      });
      const texto = `${stdout}\n${stderr}`.trim();
      if (code !== 0) throw httpError(400, texto || `git ${comando} ${bandera} falló`);
      audit.log(user.id, 'git.' + accion, { cwd: r.path, operacion: op });
      return { salida: texto, estado: await this.estado(user, cwd) };
    },

    async commit(user, cwd, mensaje, opciones = {}) {
      const r = await repo(user, cwd);
      const texto = String(mensaje ?? '').trim();
      if (!texto) throw httpError(400, 'El mensaje del commit no puede quedar vacío');
      const args = ['commit', '-m', texto];
      if (opciones.enmendar) args.push('--amend');
      if (opciones.todo) args.push('--all');
      const salida = await git(r, args);
      audit.log(user.id, 'git.commit', { cwd: r.path, mensaje: texto.split('\n')[0] });
      return { salida, estado: await this.estado(user, cwd) };
    },

    async guardarStash(user, cwd, mensaje, incluirSinRastrear) {
      const r = await repo(user, cwd);
      const args = ['stash', 'push'];
      if (incluirSinRastrear) args.push('--include-untracked');
      if (mensaje) args.push('-m', String(mensaje));
      const salida = await git(r, args);
      audit.log(user.id, 'git.stash.push', { cwd: r.path, mensaje });
      return { salida, estado: await this.estado(user, cwd) };
    },

    async aplicarStash(user, cwd, ref, quitar) {
      const r = await repo(user, cwd);
      if (!/^stash@\{\d+\}$/.test(String(ref))) throw httpError(400, 'Referencia de stash inválida');
      const salida = await git(r, ['stash', quitar ? 'pop' : 'apply', ref]);
      audit.log(user.id, quitar ? 'git.stash.pop' : 'git.stash.apply', { cwd: r.path, ref });
      return { salida, estado: await this.estado(user, cwd) };
    },

    async borrarStash(user, cwd, ref) {
      const r = await repo(user, cwd);
      if (!/^stash@\{\d+\}$/.test(String(ref))) throw httpError(400, 'Referencia de stash inválida');
      await git(r, ['stash', 'drop', ref]);
      audit.log(user.id, 'git.stash.drop', { cwd: r.path, ref });
      return this.stash(user, cwd);
    },

    /** Trae los cambios del remoto sin tocar el árbol de trabajo. */
    async traer(user, cwd) {
      const r = await repo(user, cwd);
      const salida = await gitRed(r, ['fetch', '--all', '--prune']);
      audit.log(user.id, 'git.fetch', { cwd: r.path });
      return { salida, estado: await this.estado(user, cwd) };
    },

    /**
     * Bajar. Por defecto solo avance rápido: si divergió, que lo diga en vez
     * de fabricar una fusión que nadie pidió. Con `rebase` se reordena encima.
     */
    async bajar(user, cwd, opciones = {}) {
      const r = await repo(user, cwd);
      const args = ['pull', opciones.rebase ? '--rebase' : '--ff-only'];
      const salida = await gitRed(r, args);
      audit.log(user.id, 'git.pull', { cwd: r.path, rebase: !!opciones.rebase });
      return { salida, estado: await this.estado(user, cwd) };
    },

    /**
     * Subir. Sin upstream, `--set-upstream` con el mismo nombre: es lo que uno
     * quiere el 99% de las veces al publicar una rama nueva.
     */
    async subir(user, cwd, opciones = {}) {
      const r = await repo(user, cwd);
      const estado = await this.estado(user, cwd);
      const args = ['push'];
      if (!estado.upstream) {
        if (!estado.rama) throw httpError(400, 'No hay rama actual que subir');
        args.push('--set-upstream', opciones.remoto || 'origin', estado.rama);
      }
      // Nunca `--force`: `--force-with-lease` aborta si alguien más subió algo.
      if (opciones.forzar) args.push('--force-with-lease');
      const salida = await gitRed(r, args);
      audit.log(user.id, 'git.push', { cwd: r.path, forzar: !!opciones.forzar });
      return { salida, estado: await this.estado(user, cwd) };
    },

    /** Reordenar la rama actual encima de otra. */
    async reordenar(user, cwd, sobre) {
      const r = await repo(user, cwd);
      if (!sobre || /^-/.test(String(sobre))) throw httpError(400, 'Falta sobre qué reordenar');
      const salida = await gitRed(r, ['rebase', String(sobre)], 120_000);
      audit.log(user.id, 'git.rebase', { cwd: r.path, sobre });
      return { salida, estado: await this.estado(user, cwd) };
    },

    /**
     * Situarse en un commit o una rama.
     *
     * Si el commit tiene una rama local apuntándole se cambia a la rama, no al
     * commit: quedar en HEAD desprendido sin haberlo pedido es de las cosas que
     * más confunden de git.
     */
    async situarse(user, cwd, referencia) {
      const r = await repo(user, cwd);
      const ref = String(referencia ?? '');
      if (!ref || /^-/.test(ref)) throw httpError(400, 'Referencia inválida');

      let destino = ref;
      if (/^[0-9a-f]{7,40}$/i.test(ref)) {
        const ramas = await git(r, ['branch', '--points-at', ref, '--format=%(refname:short)'])
          .catch(() => '');
        const local = ramas.split('\n').map((x) => x.trim()).filter(Boolean)[0];
        if (local) destino = local;
      }
      await git(r, ['checkout', destino]);
      audit.log(user.id, 'git.checkout', { cwd: r.path, destino });
      return { destino, desprendido: destino === ref && /^[0-9a-f]{7,40}$/i.test(ref), estado: await this.estado(user, cwd) };
    },

    /**
     * Clona un repositorio dentro de una carpeta permitida.
     *
     * El destino se arma acá y no lo manda el cliente: la carpeta pasa por
     * `paths.js` y el nombre se valida como nombre. Se rechaza si ya existe con
     * contenido —clonar encima de un proyecto sería destruirlo sin avisar.
     */
    async clonar(user, { url, dir, nombre }) {
      if (!urlDeRepoValida(url)) throw httpError(400, 'Esa dirección de repositorio no es válida');
      if (!nombreDeCarpetaValido(nombre)) throw httpError(400, 'El nombre de la carpeta no es válido');

      const destino = await guard.resolvePath(user, dir, { mustExist: true });
      const host = hosts.get(destino.root.host);
      if ((await host.stat(destino.path))?.kind !== 'dir') {
        throw httpError(400, 'El destino no es una carpeta');
      }

      const ruta = join(destino.path, nombre);
      const yaEsta = await host.stat(ruta);
      if (yaEsta) {
        const dentro = yaEsta.kind === 'dir' ? await host.list(ruta).catch(() => []) : ['x'];
        if (dentro.length) throw httpError(409, `Ya existe ${nombre} y no está vacía`);
      }

      audit.log(user.id, 'git.clone', { url, destino: ruta });
      // `--` antes de la URL: sin eso una que empiece con guion se leería como
      // opción. La validación ya lo impide; esto es el segundo cerrojo.
      const salida = await gitRed(
        { host, path: destino.path },
        ['clone', '--progress', '--', url, ruta],
        180_000,
      );
      return { path: ruta, salida };
    },

    async cambiarRama(user, cwd, nombre, crear) {
      const r = await repo(user, cwd);
      if (!nombre || /^-/.test(nombre)) throw httpError(400, 'Nombre de rama inválido');
      await git(r, crear ? ['switch', '-c', nombre] : ['switch', nombre]);
      audit.log(user.id, crear ? 'git.branch.create' : 'git.checkout', { cwd: r.path, nombre });
      return this.estado(user, cwd);
    },
  };
}
