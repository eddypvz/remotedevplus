import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EVENTS } from '@remotedevplus/protocol';
import { sandbox, services, SUPER } from './helpers.js';

/** Un socket de mentira: guarda lo que se le manda. */
function socketFalso() {
  return { readyState: 1, enviados: [], send(s) { this.enviados.push(JSON.parse(s)); } };
}

/** Espera a que llegue un aviso de git de ese repo, o se rinde. */
async function esperarGit(sock, cwd, ms = 3000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    const hit = sock.enviados.find((m) => m.t === EVENTS.GIT_CHANGED && m.cwd === cwd);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

/** Un repo de verdad: el observador se apoya en `git ls-files`. */
function repo(dir) {
  const git = (...args) => execFileSync('git', args, {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  git('init', '-q', '-b', 'main');
  return git;
}

/** Espera a que llegue un aviso de esa ruta, o se rinde. */
async function esperarAviso(sock, path, ms = 3000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    const hit = sock.enviados.find((m) => m.t === EVENTS.FS_CHANGED && m.path === path);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

describe('canal de eventos', () => {
  test('avisa cuando aparece un archivo en una carpeta observada', async () => {
    const sb = sandbox(['proyecto']);
    const { events } = services(sb, { www: 'proyecto' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);

    await conn.watch([sb.at('proyecto')]);
    writeFileSync(sb.at('proyecto', 'nuevo.txt'), 'hola');

    const aviso = await esperarAviso(sock, sb.at('proyecto'));
    assert.ok(aviso, 'no llegó el aviso de cambio');
    conn.close();
  });

  test('también avisa al borrar y al crear un subdirectorio', async () => {
    const sb = sandbox(['proyecto'], { 'proyecto/viejo.txt': 'x' });
    const { events } = services(sb, { www: 'proyecto' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);

    await conn.watch([sb.at('proyecto')]);
    rmSync(sb.at('proyecto', 'viejo.txt'));
    assert.ok(await esperarAviso(sock, sb.at('proyecto')), 'no avisó del borrado');

    sock.enviados.length = 0;
    mkdirSync(sb.at('proyecto', 'sub'));
    assert.ok(await esperarAviso(sock, sb.at('proyecto')), 'no avisó del subdirectorio');
    conn.close();
  });

  test('no se puede observar fuera de las raíces', async () => {
    const sb = sandbox(['adentro', 'afuera']);
    const { events } = services(sb, { www: 'adentro' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);

    // Ruta hermana, y el clásico intento de salirse con `..`.
    await conn.watch([sb.at('afuera'), sb.at('adentro', '..', 'afuera')]);
    assert.equal(conn.size, 0, 'suscribió una ruta fuera de las raíces');
    assert.equal(events.stats().dirs, 0);

    writeFileSync(sb.at('afuera', 'secreto.txt'), 'x');
    assert.equal(await esperarAviso(sock, sb.at('afuera'), 400), null);
    conn.close();
  });

  test('dos clientes en la misma carpeta comparten un solo observador', async () => {
    const sb = sandbox(['proyecto']);
    const { events } = services(sb, { www: 'proyecto' });
    const a = events.connect(socketFalso(), SUPER);
    const b = events.connect(socketFalso(), SUPER);

    await a.watch([sb.at('proyecto')]);
    await b.watch([sb.at('proyecto')]);
    assert.equal(events.stats().dirs, 1, 'abrió un inotify por cliente');

    // El observador vive mientras quede un interesado.
    a.close();
    assert.equal(events.stats().dirs, 1);
    b.close();
    assert.equal(events.stats().dirs, 0, 'quedó un observador filtrado');
  });

  test('cerrar la conexión suelta todo lo que observaba', async () => {
    const sb = sandbox(['proyecto', 'proyecto/uno', 'proyecto/dos']);
    const { events } = services(sb, { www: 'proyecto' });
    const conn = events.connect(socketFalso(), SUPER);

    await conn.watch([sb.at('proyecto'), sb.at('proyecto', 'uno'), sb.at('proyecto', 'dos')]);
    assert.equal(events.stats().dirs, 3);

    conn.close();
    assert.equal(events.stats().dirs, 0);
    assert.equal(events.stats().conns, 0);
  });

  test('unwatch deja de avisar', async () => {
    const sb = sandbox(['proyecto']);
    const { events } = services(sb, { www: 'proyecto' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);

    await conn.watch([sb.at('proyecto')]);
    conn.unwatch([sb.at('proyecto')]);
    assert.equal(events.stats().dirs, 0);

    writeFileSync(sb.at('proyecto', 'nuevo.txt'), 'hola');
    assert.equal(await esperarAviso(sock, sb.at('proyecto'), 400), null);
    conn.close();
  });

  test('un aviso agrupa la ráfaga en vez de emitir uno por archivo', async () => {
    const sb = sandbox(['proyecto']);
    const { events } = services(sb, { www: 'proyecto' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);

    await conn.watch([sb.at('proyecto')]);
    // Lo que hace un `npm install` a escala chica: sin agrupar, el explorador
    // releería el directorio una vez por archivo.
    for (let i = 0; i < 40; i++) writeFileSync(sb.at('proyecto', `f${i}.txt`), 'x');

    assert.ok(await esperarAviso(sock, sb.at('proyecto')));
    await new Promise((r) => setTimeout(r, 300));
    const avisos = sock.enviados.filter((m) => m.t === EVENTS.FS_CHANGED).length;
    assert.ok(avisos <= 3, `agrupó mal: ${avisos} avisos para una ráfaga`);
    conn.close();
  });

  test('avisa cuando cambia .git: un commit, un checkout', async () => {
    const sb = sandbox(['repo']);
    const git = repo(sb.at('repo'));
    writeFileSync(sb.at('repo', 'uno.txt'), 'a');
    git('add', '.');
    git('commit', '-qm', 'primero');

    const { events } = services(sb, { www: 'repo' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);
    await conn.watchGit([sb.at('repo')]);

    git('checkout', '-q', '-b', 'otra');
    assert.ok(await esperarGit(sock, sb.at('repo')), 'no avisó del checkout');
    conn.close();
  });

  test('avisa cuando se edita un archivo versionado en un subdirectorio', async () => {
    const sb = sandbox(['repo', 'repo/src/hondo']);
    const git = repo(sb.at('repo'));
    writeFileSync(sb.at('repo', 'src', 'hondo', 'a.js'), 'uno');
    git('add', '.');
    git('commit', '-qm', 'primero');

    const { events } = services(sb, { www: 'repo' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);
    await conn.watchGit([sb.at('repo')]);

    // El caso real: Claude Code escribiendo dentro del proyecto. Sin observar
    // los directorios versionados, el panel seguiría diciendo que no hay nada.
    writeFileSync(sb.at('repo', 'src', 'hondo', 'a.js'), 'dos');
    assert.ok(await esperarGit(sock, sb.at('repo')), 'no avisó de la edición');
    conn.close();
  });

  test('un repo fuera de las raíces no se puede observar', async () => {
    const sb = sandbox(['adentro', 'afuera']);
    repo(sb.at('afuera'));
    const { events } = services(sb, { www: 'adentro' });
    const conn = events.connect(socketFalso(), SUPER);

    await conn.watchGit([sb.at('afuera')]);
    assert.equal(events.stats().dirs, 0);
    conn.close();
  });

  test('cerrar la conexión también suelta los repos', async () => {
    const sb = sandbox(['repo']);
    const git = repo(sb.at('repo'));
    writeFileSync(sb.at('repo', 'uno.txt'), 'a');
    git('add', '.');
    git('commit', '-qm', 'primero');

    const { events } = services(sb, { www: 'repo' });
    const conn = events.connect(socketFalso(), SUPER);
    await conn.watchGit([sb.at('repo')]);
    assert.ok(events.stats().dirs > 0, 'no observó nada');

    conn.close();
    assert.equal(events.stats().dirs, 0, 'quedaron observadores del repo');
  });

  test('el aviso de una terminal terminada llega a las conexiones abiertas', () => {
    const sb = sandbox(['proyecto']);
    const { events } = services(sb, { www: 'proyecto' });
    const sock = socketFalso();
    const conn = events.connect(sock, SUPER);

    events.ptyExit({ id: 'abc', kind: 'shell', alive: false });
    const aviso = sock.enviados.find((m) => m.t === EVENTS.PTY_EXIT);
    assert.ok(aviso);
    assert.equal(aviso.session.id, 'abc');
    conn.close();
  });
});
