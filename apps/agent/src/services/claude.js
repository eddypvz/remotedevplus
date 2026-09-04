import { randomBytes } from 'node:crypto';
import { query, listSessions, getSessionMessages, deleteSession, renameSession } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_WS, CLAUDE_MODELS, CLAUDE_MODES, hasPermission, ALL } from '@remotedevplus/protocol';
import { plain } from '../db/index.js';
import { httpError } from '../paths.js';

const MAX_CONVERSACIONES = 12;
/** Mensajes que se guardan en memoria para reproducir al reconectar. */
const BUFFER = 2000;
/** Un permiso sin responder no puede bloquear el turno para siempre. */
const PERMISO_TTL_MS = 10 * 60_000;

/**
 * Cliente nativo de Claude Code, sobre el Agent SDK.
 *
 * La diferencia de fondo con el módulo del terminal: acá no hay una TUI
 * dibujando sobre un buffer de pantalla, hay un flujo de MENSAJES. Por eso se
 * puede tener historial de verdad, permisos como diálogo y cambiar de modelo en
 * caliente — nada de eso es posible mirando bytes de pantalla desde afuera.
 *
 * El SDK autentica con el login que ya tiene el CLI de Claude Code, así que
 * consume la suscripción del usuario y no pide ANTHROPIC_API_KEY.
 */
export function createClaude(db, cfg, audit) {
  /** @type {Map<string, object>} */
  const conversaciones = new Map();

  const q = {
    recordar: db.prepare('INSERT OR REPLACE INTO claude_sessions (session_id, user_id, cwd, created_at) VALUES (?, ?, ?, ?)'),
    mias: db.prepare('SELECT session_id FROM claude_sessions WHERE user_id = ?'),
    duena: db.prepare('SELECT * FROM claude_sessions WHERE session_id = ?'),
    olvidar: db.prepare('DELETE FROM claude_sessions WHERE session_id = ?'),
  };

  const validar = (lista, valor, porDefecto) => (
    lista.some((x) => x.id === valor) && valor !== 'default' ? valor : porDefecto
  );

  function forma(c) {
    return {
      id: c.id,
      sessionId: c.sessionId,
      cwd: c.cwd,
      title: c.title,
      // El alias que eligió el usuario ('default', 'opus'…) y el id real que
      // reporta el SDK ('claude-opus-5') son cosas distintas. Pisar uno con el
      // otro dejaba el selector sin ninguna opción que coincidiera, en blanco.
      model: c.model,
      actualModel: c.actualModel,
      permissionMode: c.permissionMode,
      state: c.state,
      messages: c.buffer.length,
      createdAt: c.createdAt,
      costUsd: c.costUsd,
      tokens: c.tokens,
      thinkingTokens: c.thinkingTokens,
    };
  }

  function emitir(c, tipo, datos) {
    const frame = JSON.stringify({ t: tipo, ...datos });
    for (const ws of c.clients) if (ws.readyState === 1) ws.send(frame);
  }

  function cambiarEstado(c, estado) {
    if (c.state === estado) return;
    c.state = estado;
    emitir(c, CLAUDE_WS.SETTINGS, { conversation: forma(c) });
  }

  /**
   * Cola de entrada del SDK.
   *
   * `query()` acepta un AsyncIterable como prompt, y eso es lo que convierte una
   * llamada suelta en una conversación viva: se le van empujando mensajes del
   * usuario sin volver a arrancar el proceso.
   */
  function crearCola() {
    const pendientes = [];
    let esperando = null;
    let cerrada = false;

    return {
      empujar(mensaje) {
        if (cerrada) return;
        if (esperando) {
          const r = esperando;
          esperando = null;
          r({ value: mensaje, done: false });
        } else {
          pendientes.push(mensaje);
        }
      },
      cerrar() {
        cerrada = true;
        if (esperando) { esperando({ value: undefined, done: true }); esperando = null; }
      },
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (pendientes.length) return Promise.resolve({ value: pendientes.shift(), done: false });
            if (cerrada) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => { esperando = resolve; });
          },
        };
      },
    };
  }

  /** El callback que el SDK llama cuando una herramienta necesita autorización. */
  function permisoDe(c) {
    return async (toolName, input, opciones) => {
      const { signal, suggestions, title, displayName, description, blockedPath, decisionReason } = opciones;
      const id = randomBytes(6).toString('hex');
      // El bridge arma la frase completa ("Claude wants to read foo.txt") y un
      // nombre corto para botones. Se usan tal cual: reconstruirlos desde
      // toolName+input da peor texto y se desactualiza con cada herramienta nueva.
      const peticion = {
        toolName, input, suggestions,
        title, displayName, description, blockedPath, decisionReason,
      };
      // Se guarda la petición, no solo su resolvedor: al reconectar hay que
      // poder volver a mostrarla, o el turno queda colgado sin que se vea por qué.
      c.pendientes.set(id, peticion);
      cambiarEstado(c, 'esperando-permiso');
      emitir(c, CLAUDE_WS.PERMISSION, { id, ...peticion });

      const decision = await new Promise((resolve) => {
        const olvidar = () => { c.permisos.delete(id); c.pendientes.delete(id); };
        const caducar = setTimeout(() => {
          olvidar();
          resolve({ behavior: 'deny', message: 'Nadie respondió a tiempo la solicitud de permiso.' });
        }, PERMISO_TTL_MS);
        caducar.unref?.();

        const abortar = () => {
          clearTimeout(caducar);
          olvidar();
          resolve({ behavior: 'deny', message: 'Cancelado.' });
        };
        signal.addEventListener('abort', abortar, { once: true });

        c.permisos.set(id, (respuesta) => {
          clearTimeout(caducar);
          signal.removeEventListener('abort', abortar);
          olvidar();
          resolve(respuesta);
        });
      });

      emitir(c, CLAUDE_WS.PERMISSION_DONE, { id, behavior: decision.behavior });
      if (c.state === 'esperando-permiso') cambiarEstado(c, 'pensando');
      audit.log(c.userId, 'claude.permission', { toolName, behavior: decision.behavior });
      return decision;
    };
  }

  /** Consume el generador del SDK y reparte cada mensaje a los clientes. */
  async function bombear(c) {
    try {
      for await (const m of c.query) {
        // El session_id lo asigna el SDK en el primer mensaje; hay que
        // capturarlo para poder reanudar y para saber de quién es.
        if (m.session_id && m.session_id !== c.sessionId) {
          c.sessionId = m.session_id;
          q.recordar.run(m.session_id, c.userId, c.cwd, Date.now());
        }
        if (m.type === 'system' && m.subtype === 'init') {
          c.actualModel = m.model || c.actualModel;
          emitir(c, CLAUDE_WS.SETTINGS, { conversation: forma(c) });
        }
        if (m.type === 'result') {
          // Acumulados, no incrementos: cada result trae el total corrido.
          c.costUsd = m.total_cost_usd ?? c.costUsd;
          const porModelo = Object.values(m.modelUsage ?? {});
          if (porModelo.length) {
            c.tokens = porModelo.reduce((acc, u) => ({
              input: acc.input + (u.inputTokens ?? 0),
              output: acc.output + (u.outputTokens ?? 0),
              cacheRead: acc.cacheRead + (u.cacheReadInputTokens ?? 0),
              cacheWrite: acc.cacheWrite + (u.cacheCreationInputTokens ?? 0),
            }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
          }
          c.thinkingTokens = 0;
          cambiarEstado(c, 'inactiva');
          emitir(c, CLAUDE_WS.IDLE, { conversation: forma(c) });
        }

        /**
         * Tareas en segundo plano.
         *
         * Un subagente o un Bash en background sobreviven al turno: el turno
         * termina, el modelo se despierta más tarde con el resultado. Sin
         * seguirlas, todo eso pasa invisible y la conversación parece colgada.
         */
        if (m.type === 'system' && m.subtype === 'task_started') {
          c.tareas.set(m.task_id, {
            id: m.task_id, descripcion: m.description,
            tipo: m.subagent_type ?? 'tarea', estado: 'corriendo',
            tokens: 0, herramientas: 0,
          });
          emitir(c, CLAUDE_WS.TASKS, { tasks: [...c.tareas.values()] });
        }
        if (m.type === 'system' && m.subtype === 'task_progress') {
          const t = c.tareas.get(m.task_id);
          if (t) {
            t.tokens = m.usage?.total_tokens ?? t.tokens;
            t.herramientas = m.usage?.tool_uses ?? t.herramientas;
            emitir(c, CLAUDE_WS.TASKS, { tasks: [...c.tareas.values()] });
          }
        }
        if (m.type === 'system' && m.subtype === 'task_notification') {
          const t = c.tareas.get(m.task_id) ?? { id: m.task_id, descripcion: m.summary, tipo: 'tarea' };
          Object.assign(t, {
            estado: m.status, resumen: m.summary, salida: m.output_file,
            tokens: m.usage?.total_tokens ?? t.tokens ?? 0,
            herramientas: m.usage?.tool_uses ?? t.herramientas ?? 0,
          });
          c.tareas.set(m.task_id, t);
          emitir(c, CLAUDE_WS.TASKS, { tasks: [...c.tareas.values()] });
        }

        // Lo único que el SDK reporta en vivo durante el turno.
        if (m.type === 'system' && m.subtype === 'thinking_tokens') {
          c.thinkingTokens = m.estimated_tokens ?? 0;
          emitir(c, CLAUDE_WS.SETTINGS, { conversation: forma(c) });
        }
        if (m.type === 'assistant' || m.type === 'user') {
          cambiarEstado(c, 'pensando');
        }

        /*
         * Los fragmentos NO entran al buffer.
         *
         * Son cientos por respuesta y el mensaje completo llega igual detrás,
         * así que guardarlos llenaría el scrollback de duplicados y haría que
         * reconectar reprodujera la respuesta letra por letra otra vez. Se
         * emiten en vivo y se descartan; quien reconecte recibe el mensaje ya
         * armado.
         */
        if (m.type === 'stream_event') {
          const delta = m.event?.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            emitir(c, CLAUDE_WS.DELTA, { uuid: m.uuid, text: delta.text });
          } else if (m.event?.type === 'content_block_stop') {
            emitir(c, CLAUDE_WS.DELTA, { uuid: m.uuid, done: true });
          }
          continue;
        }

        c.buffer.push(m);
        if (c.buffer.length > BUFFER) {
          c.buffer.splice(0, c.buffer.length - BUFFER);
          c.recortados += 1;
        }
        emitir(c, CLAUDE_WS.MESSAGE, { seq: c.recortados + c.buffer.length, message: m });
      }
      cambiarEstado(c, 'terminada');
    } catch (err) {
      if (err?.name === 'AbortError') {
        cambiarEstado(c, 'inactiva');
        return;
      }
      c.error = err?.message || String(err);
      emitir(c, CLAUDE_WS.ERROR, { message: c.error });
      cambiarEstado(c, 'terminada');
    }
  }

  function crear({ cwd, model, permissionMode, resume, title }, user) {
    if (conversaciones.size >= MAX_CONVERSACIONES) {
      throw httpError(429, `Máximo de ${MAX_CONVERSACIONES} conversaciones abiertas`);
    }
    const id = randomBytes(8).toString('hex');
    const cola = crearCola();
    const abort = new AbortController();

    const c = {
      id,
      sessionId: resume ?? null,
      cwd,
      userId: user.id,
      title: title || 'Conversación',
      model: validar(CLAUDE_MODELS, model, 'default'),
      actualModel: null,
      permissionMode: validar(CLAUDE_MODES, permissionMode, 'default'),
      state: 'inactiva',
      createdAt: Date.now(),
      costUsd: 0,
      buffer: [],
      recortados: 0,
      /**
       * Acumulado de la conversación.
       *
       * Sale de `modelUsage` del result, no de `usage`: el SDK dice que `usage`
       * es solo del bucle principal —deja afuera subagentes y llamadas
       * internas— y que `modelUsage` es "el campo correcto para contabilidad".
       * Y viene acumulado por turno, así que se LEE, no se suma.
       */
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      /** Estimación en vivo mientras piensa; se reinicia en cada turno. */
      thinkingTokens: 0,
      /** Tareas en segundo plano, por id. Sobreviven al turno. */
      tareas: new Map(),
      clients: new Set(),
      permisos: new Map(),
      pendientes: new Map(),
      cola,
      abort,
      error: null,
    };

    c.query = query({
      prompt: cola,
      options: {
        cwd,
        abortController: abort,
        canUseTool: permisoDe(c),
        // Texto token a token. Sin esto la respuesta aparece de golpe cuando el
        // mensaje está completo, y en una respuesta larga son varios segundos
        // de pantalla quieta.
        includePartialMessages: true,
        // Se apunta al binario ya instalado en vez del que trae el SDK: es el
        // mismo que usa la terminal, así que comparten sesión y configuración.
        pathToClaudeCodeExecutable: cfg.claudeBin === 'claude' ? undefined : cfg.claudeBin,
        ...(c.model !== 'default' ? { model: c.model } : {}),
        ...(c.permissionMode !== 'default' ? { permissionMode: c.permissionMode } : {}),
        ...(resume ? { resume } : {}),
      },
    });

    conversaciones.set(id, c);
    bombear(c);
    audit.log(user.id, 'claude.create', { id, cwd, model: c.model, resume: resume ?? null });
    return forma(c);
  }

  function obtener(id, user) {
    const c = conversaciones.get(id);
    if (!c) throw httpError(404, 'Esa conversación ya no existe');
    if (c.userId !== user.id && !hasPermission(user.permissions, ALL)) {
      throw httpError(404, 'Esa conversación ya no existe');
    }
    return c;
  }

  return {
    crear,

    lista(user) {
      return [...conversaciones.values()]
        .filter((c) => c.userId === user.id || hasPermission(user.permissions, ALL))
        .map(forma);
    },

    enviar(id, texto, user) {
      const c = obtener(id, user);
      if (c.state === 'terminada') throw httpError(409, 'La conversación terminó; abra otra');
      c.cola.empujar({
        type: 'user',
        message: { role: 'user', content: texto },
        parent_tool_use_id: null,
        session_id: c.sessionId ?? '',
      });
      cambiarEstado(c, 'pensando');
    },

    async interrumpir(id, user) {
      const c = obtener(id, user);
      try {
        await c.query.interrupt();
      } catch {
        // Sin entrada en streaming el SDK no soporta interrupt; el abort sí.
        c.abort.abort();
      }
      cambiarEstado(c, 'inactiva');
    },

    /** Modelo y modo se cambian en caliente: el SDK expone control para eso. */
    async ajustar(id, { model, permissionMode }, user) {
      const c = obtener(id, user);
      if (model !== undefined) {
        c.model = validar(CLAUDE_MODELS, model, 'default');
        if (c.model !== 'default') await c.query.setModel(c.model);
      }
      if (permissionMode !== undefined) {
        c.permissionMode = validar(CLAUDE_MODES, permissionMode, 'default');
        if (c.permissionMode !== 'default') await c.query.setPermissionMode(c.permissionMode);
      }
      emitir(c, CLAUDE_WS.SETTINGS, { conversation: forma(c) });
      audit.log(user.id, 'claude.settings', { id, model: c.model, permissionMode: c.permissionMode });
      return forma(c);
    },

    decidir(id, permisoId, decision, user) {
      const c = obtener(id, user);
      const resolver = c.permisos.get(permisoId);
      if (!resolver) throw httpError(409, 'Esa solicitud de permiso ya no está pendiente');
      /**
       * `updatedInput` es cómo se contesta AskUserQuestion.
       *
       * Esa herramienta no se "permite" y ya: sus respuestas viajan de vuelta
       * dentro de su propio input, en el campo `answers`. Permitirla sin eso la
       * ejecuta sin nadie que conteste, y Claude recibe "the user did not
       * answer the questions".
       */
      resolver(decision.allow
        ? {
            behavior: 'allow',
            ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
            ...(decision.updatedPermissions ? { updatedPermissions: decision.updatedPermissions } : {}),
          }
        : { behavior: 'deny', message: decision.message || 'Denegado por el usuario.' });
    },

    adjuntar(id, ws, desde, user) {
      const c = obtener(id, user);
      const inicio = Math.max(0, Number(desde) || 0);
      // Igual que el ring buffer del PTY: se reproduce el delta, no todo.
      const perdidos = Math.max(0, c.recortados - inicio);
      const resto = c.buffer.slice(Math.max(0, inicio - c.recortados));

      // Las tareas vivas se reenvían al reconectar: si no, una que arrancó
      // mientras el navegador estaba cerrado no aparecería nunca.
      if (c.tareas.size) {
        ws.send(JSON.stringify({ t: CLAUDE_WS.TASKS, tasks: [...c.tareas.values()] }));
      }
      ws.send(JSON.stringify({
        t: CLAUDE_WS.READY,
        conversation: forma(c),
        dropped: perdidos,
        from: c.recortados + c.buffer.length - resto.length,
      }));
      for (const [i, m] of resto.entries()) {
        ws.send(JSON.stringify({
          t: CLAUDE_WS.MESSAGE,
          seq: c.recortados + c.buffer.length - resto.length + i + 1,
          message: m,
        }));
      }
      // Un permiso pendiente tiene que reaparecer: si no, el turno queda
      // colgado sin que se vea por qué.
      for (const [pid, peticion] of c.pendientes) {
        ws.send(JSON.stringify({ t: CLAUDE_WS.PERMISSION, id: pid, ...peticion }));
      }
      c.clients.add(ws);
      return c;
    },

    desadjuntar(id, ws) {
      const c = conversaciones.get(id);
      if (c) c.clients.delete(ws);
    },

    cerrar(id, user) {
      const c = obtener(id, user);
      c.cola.cerrar();
      c.abort.abort();
      conversaciones.delete(id);
      audit.log(user.id, 'claude.close', { id });
      return { id };
    },

    /**
     * Conversaciones pasadas de una carpeta.
     *
     * Todas las sesiones viven bajo el mismo usuario de sistema, así que sin
     * filtrar un usuario vería los resúmenes de los demás. Se muestran las
     * propias; un super admin ve todas, coherente con que su raíz sea el disco.
     */
    async historial(user, cwds, limite = 60) {
      const carpetas = Array.isArray(cwds) ? cwds : [cwds];
      const propias = new Set(q.mias.all(user.id).map((r) => r.session_id));
      const esSuper = hasPermission(user.permissions, ALL);

      // Una sesión pertenece a una carpeta, así que hay que preguntar por cada
      // una del workspace y unir. Un mismo id no puede repetirse entre
      // carpetas, pero se deduplica igual por si dos raíces se solapan.
      const vistos = new Set();
      const salida = [];
      for (const cwd of carpetas) {
        const todo = await listSessions({ dir: cwd, limit: limite }).catch(() => []);
        for (const s of todo) {
          if (vistos.has(s.sessionId)) continue;
          if (!esSuper && !propias.has(s.sessionId)) continue;
          vistos.add(s.sessionId);
          salida.push({
            sessionId: s.sessionId,
            title: s.customTitle || s.summary || s.firstPrompt?.slice(0, 90) || 'Sin título',
            cwd: s.cwd ?? cwd,
            updatedAt: new Date(s.lastModified ?? s.createdAt ?? Date.now()).getTime(),
            gitBranch: s.gitBranch,
            mine: propias.has(s.sessionId),
          });
        }
      }
      return salida.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async renombrar(user, sessionId, titulo) {
      const duena = plain(q.duena.get(sessionId));
      if (duena && duena.user_id !== user.id && !hasPermission(user.permissions, ALL)) {
        throw httpError(404, 'No existe esa conversación');
      }
      const limpio = String(titulo || '').trim().slice(0, 120);
      if (!limpio) throw httpError(400, 'El título no puede quedar vacío');
      await renameSession(sessionId, limpio);
      audit.log(user.id, 'claude.history.rename', { sessionId, titulo: limpio });
      return { sessionId, title: limpio };
    },

    async mensajes(user, sessionId, limite = 400) {
      const duena = plain(q.duena.get(sessionId));
      if (duena && duena.user_id !== user.id && !hasPermission(user.permissions, ALL)) {
        throw httpError(404, 'No existe esa conversación');
      }
      return getSessionMessages(sessionId, { limit: limite }).catch(() => []);
    },

    async borrarHistorial(user, sessionId) {
      const duena = plain(q.duena.get(sessionId));
      if (duena && duena.user_id !== user.id && !hasPermission(user.permissions, ALL)) {
        throw httpError(404, 'No existe esa conversación');
      }
      await deleteSession(sessionId).catch(() => {});
      q.olvidar.run(sessionId);
      audit.log(user.id, 'claude.history.delete', { sessionId });
      return { sessionId };
    },

    apagar() {
      for (const c of conversaciones.values()) {
        try { c.cola.cerrar(); c.abort.abort(); } catch { /* ya cerrada */ }
      }
      conversaciones.clear();
    },
  };
}
