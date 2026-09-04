import { ref, shallowRef } from 'vue';
import { CLAUDE_WS } from '@remotedevplus/protocol';
import type { ClaudeConversation, ClaudeTask } from '@remotedevplus/protocol';

export interface PermissionAsk {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Frase ya armada por el bridge; es mejor que cualquiera que armemos acá. */
  title?: string;
  /** Nombre corto para un botón, del estilo "Leer archivo". */
  displayName?: string;
  description?: string;
  blockedPath?: string;
  decisionReason?: string;
  /** Reglas que evitarían volver a preguntar por esto en la sesión. */
  suggestions?: unknown[];
}

/**
 * Conexión a una conversación nativa.
 *
 * Misma idea de reconexión que el PTY, pero contando MENSAJES en vez de bytes:
 * el cliente lleva su índice y al reconectar pide `?since=N`, y el agente
 * reproduce solo lo que se perdió. Cerrar el socket no termina la conversación.
 */
export function useClaudeSocket(opts: {
  onMessage: (msg: any) => void;
  onReset: () => void;
  /** Texto que se está escribiendo; `null` cuando terminó de escribirse. */
  onDelta: (texto: string | null) => void;
}) {
  const status = ref<'conectando' | 'conectado' | 'reconectando' | 'error'>('conectando');
  const error = ref('');
  const conversation = ref<ClaudeConversation | null>(null);
  const pending = ref<PermissionAsk[]>([]);
  const tasks = ref<ClaudeTask[]>([]);
  const seq = ref(0);
  const socket = shallowRef<WebSocket | null>(null);

  let id: string | null = null;
  let attempt = 0;
  let timer: number | undefined;
  let closedOnPurpose = false;

  function connect(conversationId: string) {
    id = conversationId;
    closedOnPurpose = false;
    clearTimeout(timer);
    socket.value?.close();

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws/claude/${id}?since=${seq.value}`);
    socket.value = ws;

    ws.onopen = () => { attempt = 0; status.value = 'conectado'; error.value = ''; };

    ws.onmessage = (ev) => {
      let f: any;
      try { f = JSON.parse(ev.data); } catch { return; }
      switch (f.t) {
        case CLAUDE_WS.READY:
          conversation.value = f.conversation;
          // El buffer del agente ya había descartado ese tramo: hay que limpiar
          // antes de pintar o quedaría un hueco invisible en la conversación.
          if (f.dropped > 0) { seq.value = f.from; opts.onReset(); }
          break;
        case CLAUDE_WS.MESSAGE:
          seq.value = f.seq;
          // El mensaje completo llega detrás del texto en vivo y lo reemplaza.
          opts.onDelta(null);
          opts.onMessage(f.message);
          break;
        case CLAUDE_WS.DELTA:
          opts.onDelta(f.done ? null : f.text);
          break;
        case CLAUDE_WS.IDLE:
        case CLAUDE_WS.SETTINGS:
          conversation.value = f.conversation;
          break;
        case CLAUDE_WS.TASKS:
          tasks.value = f.tasks ?? [];
          break;
        case CLAUDE_WS.PERMISSION:
          if (!pending.value.some((p) => p.id === f.id)) {
            const { t, ...ask } = f;
            pending.value = [...pending.value, ask as PermissionAsk];
          }
          break;
        case CLAUDE_WS.PERMISSION_DONE:
          pending.value = pending.value.filter((p) => p.id !== f.id);
          break;
        case CLAUDE_WS.ERROR:
          error.value = f.message;
          break;
      }
    };

    ws.onclose = (ev) => {
      if (closedOnPurpose) return;
      if (ev.code === 1008 || ev.code === 1011) {
        status.value = 'error';
        error.value = ev.reason || 'El agente rechazó la conexión';
        return;
      }
      status.value = 'reconectando';
      const delay = Math.min(400 * 2 ** attempt++, 8000);
      timer = setTimeout(() => { if (id) connect(id); }, delay) as unknown as number;
    };
  }

  function send(frame: Record<string, unknown>) {
    const ws = socket.value;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  return {
    status, error, conversation, pending, tasks, seq, connect, send,
    sendText: (text: string) => send({ t: CLAUDE_WS.SEND, text }),
    interrupt: () => send({ t: CLAUDE_WS.INTERRUPT }),
    decide: (
      askId: string,
      allow: boolean,
      extra?: { updatedPermissions?: unknown[]; updatedInput?: Record<string, unknown> },
    ) => send({ t: CLAUDE_WS.DECIDE, id: askId, decision: { allow, ...extra } }),
    set: (settings: { model?: string; permissionMode?: string }) =>
      send({ t: CLAUDE_WS.SET, settings }),
    wake: () => {
      if (!id || closedOnPurpose || status.value === 'error') return;
      if (socket.value?.readyState === WebSocket.OPEN) return;
      attempt = 0;
      connect(id);
    },
    dispose: () => {
      closedOnPurpose = true;
      clearTimeout(timer);
      socket.value?.close();
      socket.value = null;
    },
  };
}
