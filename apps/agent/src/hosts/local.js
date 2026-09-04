import * as fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, basename } from 'node:path';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { LIMITS } from '@remotedevplus/protocol';

function kindOf(d) {
  if (d.isSymbolicLink()) return 'symlink';
  if (d.isDirectory()) return 'dir';
  if (d.isFile()) return 'file';
  return 'other';
}

/** Heurística de binario: un NUL en los primeros 8KB. */
function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** @implements {import('./host.js').Host} */
export class LocalHost {
  id = 'local';
  label = 'Esta máquina';

  realpath(p) { return fsp.realpath(p); }

  async stat(p) {
    try {
      const s = await fsp.lstat(p);
      return { kind: kindOf(s), size: s.size, mtime: s.mtimeMs, mode: s.mode };
    } catch { return null; }
  }

  async list(p) {
    const dirents = await fsp.readdir(p, { withFileTypes: true });
    const out = [];
    for (const d of dirents.slice(0, LIMITS.DIR_ENTRIES_MAX)) {
      const full = join(p, d.name);
      let size = null, mtime = null;
      try {
        const s = await fsp.lstat(full);
        size = s.size; mtime = s.mtimeMs;
      } catch { /* carrera o permiso: se lista igual, sin metadatos */ }
      out.push({ name: d.name, path: full, kind: kindOf(d), size, mtime });
    }
    // Directorios primero, después alfabético insensible a mayúsculas.
    out.sort((a, b) =>
      (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }

  async readFile(p) {
    const s = await fsp.stat(p);
    if (s.size > LIMITS.FILE_READ_MAX) {
      const err = new Error(`El archivo pesa ${s.size} bytes, el máximo es ${LIMITS.FILE_READ_MAX}`);
      err.statusCode = 413;
      throw err;
    }
    const buf = await fsp.readFile(p);
    if (looksBinary(buf)) return { content: '', encoding: 'binary', size: s.size };
    return { content: buf.toString('utf8'), encoding: 'utf8', size: s.size };
  }

  async writeFile(p, content) {
    // Escritura atómica: un tmp al lado y rename, para que un fallo a mitad no
    // deje el archivo truncado.
    const tmp = join(p, '..', `.${basename(p)}.rdp-tmp-${process.pid}`);
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, p);
  }

  mkdir(p) { return fsp.mkdir(p, { recursive: true }); }
  remove(p, recursive) { return fsp.rm(p, { recursive, force: false }); }
  rename(from, to) { return fsp.rename(from, to); }

  spawnPty({ file, args, cwd, cols, rows, env }) {
    return pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env: { ...process.env, ...env, TERM: 'xterm-256color' },
    });
  }

  exec(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });

      /*
       * Un tope de tiempo para lo que sale a la red.
       *
       * Sin esto, un `git push` contra un remoto que no responde deja la
       * petición colgada para siempre y el usuario sin saber qué pasó. Se manda
       * SIGTERM y se devuelve un error normal.
       */
      let vencido = false;
      const reloj = opts.timeoutMs
        ? setTimeout(() => { vencido = true; child.kill('SIGTERM'); }, opts.timeoutMs)
        : null;

      child.on('error', (err) => { if (reloj) clearTimeout(reloj); reject(err); });
      child.on('close', (code) => {
        if (reloj) clearTimeout(reloj);
        if (vencido) {
          resolve({ code: 124, stdout, stderr: `${stderr}\nSe agotó el tiempo de espera.` });
          return;
        }
        resolve({ code, stdout, stderr });
      });
    });
  }
}

export function createHosts() {
  const local = new LocalHost();
  const byId = new Map([[local.id, local]]);
  return {
    get(id = 'local') {
      const h = byId.get(id);
      if (!h) {
        const err = new Error(`Host desconocido: ${id}`);
        err.statusCode = 404;
        throw err;
      }
      return h;
    },
    list() { return [...byId.values()].map((h) => ({ id: h.id, label: h.label })); },
  };
}
