import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Ring } from '../apps/agent/src/services/pty.js';
import { sandbox, services, SUPER } from './helpers.js';

describe('ring buffer del PTY', () => {
  /**
   * El offset absoluto en bytes es el `seq` del protocolo: es lo que permite
   * que al reconectar se reproduzca solo el delta y el scrollback quede
   * continuo, en vez de repintar la pantalla.
   */
  test('reproduce el delta y avisa cuando descartó', () => {
    const r = new Ring(10);
    r.push(Buffer.from('abcde'));
    r.push(Buffer.from('fghij'));
    assert.equal(r.end, 10);
    assert.equal(r.since(0).data.toString(), 'abcdefghij');
    assert.equal(r.since(5).data.toString(), 'fghij');
    assert.equal(r.since(10).data.toString(), '', 'al día no reproduce nada');

    r.push(Buffer.from('klmno'));
    assert.equal(r.base, 5, 'descartó los primeros 5 bytes');
    const viejo = r.since(0);
    assert.equal(viejo.dropped, 5, 'avisa cuánto se perdió para que el cliente limpie');
    assert.equal(viejo.data.toString(), 'fghijklmno');
    assert.equal(r.since(7).dropped, 0);
    assert.equal(r.since(7).data.toString(), 'hijklmno');
    assert.equal(r.since(999).data.toString(), '', 'un offset futuro no revienta');
  });
});

describe('banderas de Claude Code', () => {
  /**
   * Los argumentos vienen del navegador. node-pty no invoca un shell, así que
   * no hay inyección de comandos, pero una cadena arbitraria podría hacerse
   * pasar por otra bandera de claude. Se valida contra la lista del protocolo.
   */
  const casos = [
    ['sin opciones', {}, ''],
    ['modelo', { model: 'opus' }, '--model opus'],
    ['modo', { permissionMode: 'plan' }, '--permission-mode plan'],
    ['los dos', { model: 'sonnet', permissionMode: 'acceptEdits' }, '--model sonnet --permission-mode acceptEdits'],
    ['"default" no manda bandera', { model: 'default', permissionMode: 'default' }, ''],
    ['modelo inventado', { model: 'gpt-9' }, ''],
    ['intento de colar una bandera', { model: '--allow-dangerously-skip-permissions' }, ''],
    ['intento en el modo', { permissionMode: 'plan --debug' }, ''],
  ];

  for (const [nombre, opts, esperado] of casos) {
    test(nombre, async () => {
      const sb = sandbox(['w']);
      const svc = services(sb, { w: 'w' });
      svc.cfg.claudeBin = '/bin/echo';   // imprime sus argumentos y termina
      const s = svc.pty.create({ kind: 'claude', cwd: sb.at('w'), ...opts }, SUPER);

      const salida = await new Promise((resolve) => {
        let acc = '';
        svc.pty.attach(s.id, { readyState: 1, send: (d) => { if (Buffer.isBuffer(d)) acc += d.toString(); } }, 0);
        setTimeout(() => resolve(acc), 400);
      });
      assert.equal(salida.replace(/[\r\n]+/g, ' ').trim(), esperado);
      svc.pty.kill(s.id, SUPER);
    });
  }
});
