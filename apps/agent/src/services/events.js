import { join } from 'node:path';
import { EVENTS } from '@remotedevplus/protocol';

/**
 * Canal de eventos: lo que el agente empuja sin que se lo pidan.
 *
 * Antes de esto el explorador solo se enteraba de un archivo nuevo si el
 * usuario refrescaba a mano, y Claude Code escribiendo archivos era justamente
 * el caso más común. Un canal aparte y no un socket por módulo: una tablet que
 * suspende la pestaña reconecta uno solo.
 *
 * Dos reglas que sostienen el diseño:
 *
 * - **Un inotify por directorio, no por cliente.** Dos pestañas mirando la
 *   misma carpeta comparten el observador; el contador de suscriptores decide
 *   cuándo cerrarlo. Sin esto, cada recarga de la página filtraría un watcher.
 * - **La frontera de rutas se aplica al suscribir.** `paths.js` valida el
 *   directorio contra las raíces del usuario antes de observarlo, igual que en
 *   cualquier lectura. Suscribirse no es una forma de mirar afuera.
 */
export function createEvents(hosts, guard) {
  /** Observadores vivos, uno por directorio. */
  const dirs = new Map();
  /** Conexiones abiertas, para los eventos que no dependen de una ruta. */
  const conns = new Set();

  /**
   * Ventana de agrupado.
   *
   * Guardar un archivo dispara varios eventos del sistema (el temporal, el
   * rename, el mtime del directorio) y un `npm install` dispara miles. Sin
   * agrupar, el explorador releería el directorio decenas de veces por segundo.
   */
  const AGRUPAR_MS = 150;

  /** Tope por conexión: un cliente no puede agotar los inotify del sistema. */
  const MAX_POR_CONEXION = 300;

  /**
   * Los directorios de un repo que hay que observar para saber si git cambió.
   *
   * Son dos conjuntos. `.git` y sus refs cubren lo que hace git —commit,
   * checkout, stage, stash, fetch, rebase—: son cuatro directorios y avisan al
   * instante. El resto son los directorios que contienen archivos versionados,
   * y cubren lo otro: que alguien edite un archivo y el estado del árbol de
   * trabajo deje de ser el que muestra el panel.
   *
   * Se piden a git en vez de recorrer el disco porque git ya sabe cuáles son, y
   * saltea `node_modules` y todo lo ignorado sin tener que mirarlo.
   */
  const MAX_DIRS_REPO = 400;

  async function dirsDelRepo(repo, hostId) {
    const base = [repo, join(repo, '.git'), join(repo, '.git', 'refs', 'heads'), join(repo, '.git', 'refs', 'remotes')];
    try {
      const r = await hosts.get(hostId).exec('git', ['ls-files', '-z'], { cwd: repo, timeoutMs: 10000 });
      if (r.code !== 0) return base;
      const dirs = new Set();
      for (const rel of r.stdout.split('\0')) {
        const corte = rel.lastIndexOf('/');
        if (corte > 0) dirs.add(join(repo, rel.slice(0, corte)));
      }
      // Los menos profundos primero: si hay que recortar, se conserva lo que más
      // se mira.
      const ordenados = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
      return [...base, ...ordenados.slice(0, MAX_DIRS_REPO)];
    } catch {
      return base;
    }
  }

  function observar(dir, hostId, avisar) {
    let d = dirs.get(dir);
    if (!d) {
      d = { subs: new Set(), timer: null, cerrar: null };
      try {
        d.cerrar = hosts.get(hostId).watch(dir, () => {
          if (d.timer) return;
          d.timer = setTimeout(() => {
            d.timer = null;
            for (const fn of d.subs) fn();
          }, AGRUPAR_MS);
          d.timer.unref?.();
        });
      } catch {
        // El directorio puede haber desaparecido entre el resolve y el watch.
        return null;
      }
      dirs.set(dir, d);
    }
    d.subs.add(avisar);

    return () => {
      d.subs.delete(avisar);
      if (d.subs.size) return;
      if (d.timer) clearTimeout(d.timer);
      d.cerrar?.();
      dirs.delete(dir);
    };
  }

  /**
   * Una conexión de un cliente. Mantiene sus propias suscripciones y las suelta
   * todas al cerrarse: si el navegador se va, no queda nada observando.
   */
  function connect(socket, user) {
    const mias = new Map();
    const conn = { socket, user };
    conns.add(conn);

    const enviar = (msg) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };

    async function watch(paths) {
      for (const raw of paths || []) {
        if (typeof raw !== 'string') continue;
        if (mias.has(raw) || mias.size >= MAX_POR_CONEXION) continue;
        let resuelto;
        try {
          resuelto = await guard.resolvePath(user, raw, { mustExist: true });
        } catch {
          // Fuera de las raíces o inexistente: se ignora en silencio. El cliente
          // pide observar lo que tiene desplegado y puede ir por detrás del
          // disco; un error acá sería ruido, no información.
          continue;
        }
        const soltar = observar(resuelto.path, resuelto.root.host, () => {
          enviar({ t: EVENTS.FS_CHANGED, path: raw });
        });
        if (soltar) mias.set(raw, soltar);
      }
    }

    /** Repos observados por esta conexión: repo → soltar todos sus directorios. */
    const repos = new Map();

    async function watchGit(paths) {
      for (const raw of paths || []) {
        if (typeof raw !== 'string' || repos.has(raw)) continue;
        let resuelto;
        try {
          resuelto = await guard.resolvePath(user, raw, { mustExist: true });
        } catch {
          continue;
        }
        // Marcado antes del await para que dos suscripciones seguidas al mismo
        // repo no abran los observadores dos veces.
        repos.set(raw, () => {});
        const avisar = () => enviar({ t: EVENTS.GIT_CHANGED, cwd: raw });
        const dirs = await dirsDelRepo(resuelto.path, resuelto.root.host);
        if (!repos.has(raw)) return; // se dio de baja mientras se resolvía
        const sueltos = dirs
          .map((d) => observar(d, resuelto.root.host, avisar))
          .filter(Boolean);
        repos.set(raw, () => sueltos.forEach((fn) => fn()));
      }
    }

    function unwatchGit(paths) {
      for (const raw of paths || []) {
        repos.get(raw)?.();
        repos.delete(raw);
      }
    }

    function unwatch(paths) {
      for (const raw of paths || []) {
        mias.get(raw)?.();
        mias.delete(raw);
      }
    }

    function close() {
      for (const soltar of mias.values()) soltar();
      mias.clear();
      for (const soltar of repos.values()) soltar();
      repos.clear();
      conns.delete(conn);
    }

    return { watch, unwatch, watchGit, unwatchGit, close, enviar, get size() { return mias.size; } };
  }

  /**
   * Avisa a todas las conexiones de un usuario. Se usa para lo que no cuelga de
   * una ruta —una terminal que terminó—, donde no hay suscripción que filtrar.
   */
  function broadcast(msg, userId = null) {
    for (const c of conns) {
      if (userId !== null && c.user?.id !== userId) continue;
      if (c.socket.readyState === 1) c.socket.send(JSON.stringify(msg));
    }
  }

  const ptyExit = (session) => broadcast({ t: EVENTS.PTY_EXIT, session });

  /** Para los tests: cuántos observadores y conexiones hay realmente abiertos. */
  const stats = () => ({ dirs: dirs.size, conns: conns.size });

  return { connect, broadcast, ptyExit, stats };
}
