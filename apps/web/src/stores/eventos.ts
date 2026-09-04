import { defineStore } from 'pinia';
import { ref } from 'vue';
import { EVENTS } from '@remotedevplus/protocol';

type Escucha = (path: string) => void;

/**
 * El canal que el agente empuja: cambios en disco y terminales que terminan.
 *
 * Uno solo para toda la aplicación. Cada módulo que necesita enterarse se
 * suscribe acá en vez de abrir su propio socket, porque una tablet que
 * suspende la pestaña reconecta uno y no cinco.
 *
 * Las suscripciones se cuentan: dos paneles mirando la misma carpeta piden
 * `watch` una sola vez, y el agente solo deja de observarla cuando se va el
 * último interesado. Sin el contador, cerrar un panel dejaría al otro ciego.
 */
export const useEventos = defineStore('eventos', () => {
  const conectado = ref(false);

  const socket = ref<WebSocket | null>(null);
  /** ruta → cuántos interesados */
  const observadas = new Map<string, number>();
  const alCambiar = new Set<Escucha>();
  const alSalirPty = new Set<(session: any) => void>();
  const alCambiarGit = new Set<Escucha>();
  /** Repos observados, para poder resuscribirlos tras una reconexión. */
  const repos = new Map<string, number>();

  let intento = 0;
  let reintento: number | undefined;
  let cerradoAProposito = false;

  function url() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws/events`;
  }

  function enviar(msg: unknown) {
    const ws = socket.value;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function connect() {
    if (socket.value && socket.value.readyState <= WebSocket.OPEN) return;
    cerradoAProposito = false;
    clearTimeout(reintento);

    const ws = new WebSocket(url());
    socket.value = ws;

    ws.onopen = () => {
      intento = 0;
      conectado.value = true;
      // Se resuscribe todo lo que había: tras una reconexión el agente no
      // recuerda nada de esta conexión, y el explorador quedaría mudo.
      const paths = [...observadas.keys()];
      if (paths.length) enviar({ t: 'watch', paths });
      const gits = [...repos.keys()];
      if (gits.length) enviar({ t: 'watch-git', paths: gits });
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === EVENTS.FS_CHANGED) {
        for (const fn of alCambiar) fn(msg.path);
      } else if (msg.t === EVENTS.PTY_EXIT) {
        for (const fn of alSalirPty) fn(msg.session);
      } else if (msg.t === EVENTS.GIT_CHANGED) {
        for (const fn of alCambiarGit) fn(msg.cwd);
      }
    };

    ws.onclose = () => {
      conectado.value = false;
      if (cerradoAProposito) return;
      const espera = Math.min(500 * 2 ** intento++, 10000);
      reintento = setTimeout(connect, espera) as unknown as number;
    };

    ws.onerror = () => { /* onclose se encarga del reintento */ };
  }

  /** Al volver del segundo plano se reconecta ya, sin esperar el backoff. */
  function wake() {
    if (socket.value?.readyState === WebSocket.OPEN) return;
    intento = 0;
    connect();
  }

  function watch(path: string) {
    const n = observadas.get(path) ?? 0;
    observadas.set(path, n + 1);
    if (n === 0) enviar({ t: 'watch', paths: [path] });
  }

  function unwatch(path: string) {
    const n = observadas.get(path) ?? 0;
    if (n <= 1) {
      observadas.delete(path);
      enviar({ t: 'unwatch', paths: [path] });
    } else {
      observadas.set(path, n - 1);
    }
  }

  /** Lo que tiene suscrito cada grupo, para poder diferenciar sin pisar a otros. */
  const grupos = new Map<string, Set<string>>();

  /**
   * Ajusta las suscripciones de UN grupo a un conjunto exacto.
   *
   * Por grupo y no global: el explorador sigue sus carpetas desplegadas y otro
   * módulo puede seguir las suyas. Reemplazar el conjunto entero dejaría ciego
   * al que no habló último. El contador de `watch`/`unwatch` hace el resto.
   */
  function sincronizarGrupo(id: string, paths: string[]) {
    const antes = grupos.get(id) ?? new Set<string>();
    const ahora = new Set(paths);
    for (const p of ahora) if (!antes.has(p)) watch(p);
    for (const p of antes) if (!ahora.has(p)) unwatch(p);
    grupos.set(id, ahora);
  }

  /**
   * Observa un repositorio entero: `.git` y los directorios con archivos
   * versionados. El agente decide cuáles son preguntándole a git, que ya sabe
   * saltear `node_modules` y todo lo ignorado.
   */
  function watchGit(repo: string) {
    const n = repos.get(repo) ?? 0;
    repos.set(repo, n + 1);
    if (n === 0) enviar({ t: 'watch-git', paths: [repo] });
  }

  function unwatchGit(repo: string) {
    const n = repos.get(repo) ?? 0;
    if (n <= 1) {
      repos.delete(repo);
      enviar({ t: 'unwatch-git', paths: [repo] });
    } else {
      repos.set(repo, n - 1);
    }
  }

  function onGitChanged(fn: Escucha) {
    alCambiarGit.add(fn);
    return () => alCambiarGit.delete(fn);
  }

  function onFsChanged(fn: Escucha) {
    alCambiar.add(fn);
    return () => alCambiar.delete(fn);
  }

  function onPtyExit(fn: (session: any) => void) {
    alSalirPty.add(fn);
    return () => alSalirPty.delete(fn);
  }

  function dispose() {
    cerradoAProposito = true;
    clearTimeout(reintento);
    socket.value?.close();
    socket.value = null;
    conectado.value = false;
  }

  return {
    conectado, connect, wake, dispose,
    watch, unwatch, sincronizarGrupo, watchGit, unwatchGit,
    onFsChanged, onGitChanged, onPtyExit,
  };
});
