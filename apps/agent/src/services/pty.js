import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { LIMITS, PTY_CONTROL, PTY_KINDS, CLAUDE_MODELS, CLAUDE_MODES } from '@remotedevplus/protocol';
import { httpError } from '../paths.js';

const MAX_SESSIONS = 32;
/** Cuánto sobrevive una sesión muerta para que el cliente alcance a ver la salida. */
const REAP_AFTER_EXIT_MS = 5 * 60_000;

/**
 * Scrollback del PTY indexado por offset absoluto en bytes.
 *
 * El `seq` del protocolo es ese offset. El cliente no necesita que se lo
 * manden: cuenta los bytes que recibió. Al reconectar pide `?since=N` y acá se
 * reproduce el delta — no un repintado de pantalla, sino la continuación exacta
 * del stream, que es lo que preserva el scrollback.
 */
class Ring {
  #chunks = [];
  #bytes = 0;
  /** Bytes ya descartados por el tope: offset del primer byte que aún se tiene. */
  #base = 0;

  constructor(max) { this.max = max; }

  get end() { return this.#base + this.#bytes; }
  get base() { return this.#base; }

  push(buf) {
    this.#chunks.push(buf);
    this.#bytes += buf.length;
    while (this.#bytes > this.max && this.#chunks.length > 1) {
      const gone = this.#chunks.shift();
      this.#bytes -= gone.length;
      this.#base += gone.length;
    }
  }

  /** @returns {{data: Buffer, dropped: number}} `dropped` = bytes que ya no existen. */
  since(offset) {
    const from = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    if (from >= this.end) return { data: Buffer.alloc(0), dropped: 0 };
    if (from < this.#base) {
      return { data: Buffer.concat(this.#chunks), dropped: this.#base - from };
    }
    let skip = from - this.#base;
    const out = [];
    for (const c of this.#chunks) {
      if (skip >= c.length) { skip -= c.length; continue; }
      out.push(skip > 0 ? c.subarray(skip) : c);
      skip = 0;
    }
    return { data: Buffer.concat(out), dropped: 0 };
  }
}

export function createPty(hosts, cfg, audit) {
  /** @type {Map<string, object>} */
  const sessions = new Map();

  function titleFor(kind, cwd) {
    if (kind === 'claude') return 'Claude Code';
    return basename(cwd) || 'Terminal';
  }

  /**
   * Solo se le pasan al CLI valores de la lista del protocolo.
   *
   * Estos argumentos vienen del navegador, y aunque node-pty no invoca un shell
   * —así que no hay inyección de comandos— una cadena arbitraria igual podría
   * hacerse pasar por otra bandera de claude. La lista blanca lo cierra.
   */
  function claudeArgs({ model, permissionMode }) {
    const args = [];
    if (model && model !== 'default' && CLAUDE_MODELS.some((m) => m.id === model)) {
      args.push('--model', model);
    }
    if (permissionMode && permissionMode !== 'default' && CLAUDE_MODES.some((m) => m.id === permissionMode)) {
      args.push('--permission-mode', permissionMode);
    }
    return args;
  }

  function commandFor(kind, opts) {
    // El binario de Claude Code corre en un PTY real, con TERM y tamaño
    // correctos: por eso sus menús de opciones, Shift+Tab y Esc funcionan igual
    // que en una terminal nativa.
    if (kind === 'claude') return { file: cfg.claudeBin, args: claudeArgs(opts) };
    return { file: cfg.shell, args: ['-l'] };
  }

  function publicShape(s) {
    return {
      id: s.id, kind: s.kind, cwd: s.cwd, host: s.host, title: s.title,
      alive: s.alive, createdAt: s.createdAt, cols: s.cols, rows: s.rows,
      bytes: s.ring.end,
      // Con qué se lanzó. El agente no puede saber si después se cambió desde
      // dentro del TUI, así que la UI lo muestra como "iniciado con", no como
      // estado actual.
      model: s.model, permissionMode: s.permissionMode,
    };
  }

  function create({ kind = 'shell', cwd, host = 'local', cols = 80, rows = 24, model, permissionMode }, user) {
    if (!PTY_KINDS.includes(kind)) throw httpError(400, `Tipo de terminal desconocido: ${kind}`);
    if (sessions.size >= MAX_SESSIONS) throw httpError(429, `Máximo de ${MAX_SESSIONS} terminales abiertas`);

    const h = hosts.get(host);
    const { file, args } = commandFor(kind, { model, permissionMode });
    const id = randomBytes(8).toString('hex');

    let proc;
    try {
      proc = h.spawnPty({ file, args, cwd, cols, rows });
    } catch (err) {
      throw httpError(500, `No se pudo lanzar ${file}: ${err.message}`);
    }

    const s = {
      id, kind, cwd, host, cols, rows,
      model: kind === 'claude' ? (model || 'default') : undefined,
      permissionMode: kind === 'claude' ? (permissionMode || 'default') : undefined,
      title: titleFor(kind, cwd),
      alive: true,
      createdAt: Date.now(),
      userId: user?.id ?? null,
      proc,
      ring: new Ring(LIMITS.PTY_RING_BYTES),
      clients: new Set(),
      reapTimer: null,
    };

    proc.onData((chunk) => {
      // node-pty entrega string ya decodificado en utf8 (con StringDecoder, así
      // que los multibyte partidos entre lecturas llegan enteros). Se vuelve a
      // bytes porque el offset del protocolo se cuenta en bytes.
      const buf = Buffer.from(chunk, 'utf8');
      s.ring.push(buf);
      for (const ws of s.clients) {
        if (ws.readyState === 1) ws.send(buf, { binary: true });
      }
    });

    proc.onExit(({ exitCode, signal }) => {
      s.alive = false;
      s.exitCode = exitCode;
      const msg = JSON.stringify({ t: PTY_CONTROL.EXIT, code: exitCode, signal });
      for (const ws of s.clients) { if (ws.readyState === 1) ws.send(msg); }
      audit.log(s.userId, 'pty.exit', { id, kind, code: exitCode });
      s.reapTimer = setTimeout(() => sessions.delete(id), REAP_AFTER_EXIT_MS);
      s.reapTimer.unref?.();
    });

    sessions.set(id, s);
    audit.log(user?.id ?? null, 'pty.create', { id, kind, cwd, host, model, permissionMode });
    return publicShape(s);
  }

  function get(id) {
    const s = sessions.get(id);
    if (!s) throw httpError(404, 'Esa terminal ya no existe');
    return s;
  }

  /**
   * Adjunta un WebSocket a una sesión y reproduce lo que se perdió.
   * El PTY siguió vivo mientras no había nadie mirando: eso es lo que hace que
   * el iPad pueda suspender la pestaña sin matar a Claude Code.
   */
  function attach(id, ws, since) {
    const s = get(id);
    const { data, dropped } = s.ring.since(since);

    ws.send(JSON.stringify({
      t: PTY_CONTROL.ATTACHED,
      since: s.ring.end, dropped, cols: s.cols, rows: s.rows,
    }));
    // Si el ring ya había descartado ese tramo, el cliente tiene que limpiar
    // antes de pintar: si no, quedaría un hueco invisible en medio del texto.
    if (dropped > 0) ws.send(JSON.stringify({ t: PTY_CONTROL.RESET }));
    if (data.length) ws.send(data, { binary: true });
    if (!s.alive) ws.send(JSON.stringify({ t: PTY_CONTROL.EXIT, code: s.exitCode ?? 0 }));

    s.clients.add(ws);
    return s;
  }

  function detach(id, ws) {
    const s = sessions.get(id);
    if (s) s.clients.delete(ws);
  }

  function write(id, data) {
    const s = get(id);
    if (s.alive) s.proc.write(data);
  }

  /**
   * Con varios clientes en la misma sesión gana el último que reporta tamaño.
   * Es lo correcto para un sistema mono-tenant: normalmente hay una pantalla
   * mirando, y si hay dos, la que interactuó de último es la que importa.
   */
  function resize(id, cols, rows) {
    const s = get(id);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return;
    if (cols > 1000 || rows > 1000) return;
    if (s.cols === cols && s.rows === rows) return;
    s.cols = cols; s.rows = rows;
    if (s.alive) s.proc.resize(cols, rows);
  }

  function kill(id, user) {
    const s = get(id);
    if (s.alive) s.proc.kill();
    if (s.reapTimer) clearTimeout(s.reapTimer);
    sessions.delete(id);
    audit.log(user?.id ?? null, 'pty.kill', { id });
    return { id };
  }

  return {
    create, attach, detach, write, resize, kill,
    list() { return [...sessions.values()].map(publicShape); },
    has(id) { return sessions.has(id); },
    shutdown() {
      for (const s of sessions.values()) { try { s.proc.kill(); } catch {} }
      sessions.clear();
    },
  };
}

export { Ring };
