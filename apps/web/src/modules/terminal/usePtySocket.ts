import { ref, shallowRef } from 'vue';
import { PTY_CONTROL } from '@remotedevplus/protocol';

export type PtyStatus = 'conectando' | 'conectado' | 'reconectando' | 'terminado' | 'error';

/**
 * Conexión al PTY del agente.
 *
 * Dos ideas hacen todo el trabajo:
 *
 *  1. Los frames binarios son bytes crudos en las dos direcciones. Nada de
 *     JSON ni base64 en el camino caliente; el control va en frames de texto.
 *
 *  2. `received` cuenta los bytes vistos, y ese número ES el `seq` del
 *     protocolo. Al reconectar se pide `?since=received` y el agente reproduce
 *     solo el delta. Por eso el iPad puede suspender la pestaña o perder el
 *     wifi y Claude Code sigue donde estaba, con el scrollback intacto — no es
 *     un repintado de pantalla, es la continuación del stream.
 */
export function usePtySocket(opts: {
  onData: (bytes: Uint8Array) => void;
  onReset: () => void;
  onExit: (code: number) => void;
}) {
  const status = ref<PtyStatus>('conectando');
  const message = ref('');
  const received = ref(0);
  const socket = shallowRef<WebSocket | null>(null);

  let sessionId: string | null = null;
  let attempt = 0;
  let retryTimer: number | undefined;
  let closedOnPurpose = false;
  const encoder = new TextEncoder();

  function url(id: string) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws/pty/${id}?since=${received.value}`;
  }

  function connect(id: string) {
    sessionId = id;
    closedOnPurpose = false;
    clearTimeout(retryTimer);
    socket.value?.close();

    status.value = received.value > 0 ? 'reconectando' : 'conectando';
    const ws = new WebSocket(url(id));
    ws.binaryType = 'arraybuffer';
    socket.value = ws;

    ws.onopen = () => {
      attempt = 0;
      status.value = 'conectado';
      message.value = '';
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === PTY_CONTROL.RESET) {
          // El ring buffer ya había descartado ese tramo: hay que limpiar antes
          // de pintar, o quedaría un hueco invisible en medio del texto.
          received.value = 0;
          opts.onReset();
        } else if (msg.t === PTY_CONTROL.EXIT) {
          status.value = 'terminado';
          message.value = `El proceso terminó con código ${msg.code}`;
          opts.onExit(msg.code);
        }
        return;
      }
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      received.value += bytes.byteLength;
      opts.onData(bytes);
    };

    ws.onclose = (ev) => {
      if (closedOnPurpose || status.value === 'terminado') return;
      if (ev.code === 1008 || ev.code === 1011) {
        status.value = 'error';
        message.value = ev.reason || 'El agente rechazó la conexión';
        return;
      }
      scheduleRetry();
    };

    ws.onerror = () => { if (status.value === 'conectado') status.value = 'reconectando'; };
  }

  /** Backoff con techo: en una tablet que despierta, el primer intento debe ser rápido. */
  function scheduleRetry() {
    status.value = 'reconectando';
    const delay = Math.min(400 * 2 ** attempt++, 8000);
    retryTimer = setTimeout(() => { if (sessionId) connect(sessionId); }, delay) as unknown as number;
  }

  function send(data: string) {
    const ws = socket.value;
    if (ws?.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
  }

  function resize(cols: number, rows: number) {
    const ws = socket.value;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: PTY_CONTROL.RESIZE, cols, rows }));
    }
  }

  /** Al volver del segundo plano se reintenta ya, sin esperar el backoff. */
  function wake() {
    if (!sessionId || status.value === 'terminado' || status.value === 'error') return;
    if (socket.value?.readyState === WebSocket.OPEN) return;
    attempt = 0;
    connect(sessionId);
  }

  function dispose() {
    closedOnPurpose = true;
    clearTimeout(retryTimer);
    socket.value?.close();
    socket.value = null;
  }

  return { status, message, received, connect, send, resize, wake, dispose };
}
