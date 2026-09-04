#!/usr/bin/env node
import './quiet.js';
import { createInterface } from 'node:readline';
import { ROLES, PERMISSIONS, ALL } from '@remotedevplus/protocol';
import { loadConfig } from './config.js';
import { buildServer, createServices } from './server.js';

/** El CLI no tiene sesión: actúa con privilegio total, igual que quien tenga el
 *  archivo de la base en el disco. */
const ROOT_ACTOR = { id: null, permissions: [ALL] };

/** Las raíces de un usuario pueden ser rutas, nombres legados, o nada. */
function describeRoots(roots) {
  if (!roots || !roots.length) return 'raíces: las del agente';
  if (typeof roots[0] === 'string') return `raíces (nombres): ${roots.join(', ')}`;
  return `raíces: ${roots.map((r) => `${r.name}=${r.path}`).join('  ')}`;
}

const USAGE = `remotedevplus — agente de desarrollo remoto

  remotedevplus serve [raíz...] [opciones]
  remotedevplus user <add|list|passwd|perms|roots|disable|enable|rm> ...

Opciones de serve
  --root <[nombre=]ruta>   Raíz expuesta. Repetible. Es la frontera de seguridad.
  --port <n>               Puerto (default 8790)
  --host <ip>              Interfaz (default 127.0.0.1)
  --tls-cert <f> --tls-key <f>
                           HTTPS directo, sin proxy inverso. Recomendado: la API
                           de portapapeles del navegador exige secure context.
  --trust-proxy            Detrás de nginx/apache/Caddy
  --base-path <p>          Montar en un subpath
  --db <f>                 Base SQLite (default data/remotedevplus.db)

Ejemplos
  remotedevplus serve /var/www --port 8790
  remotedevplus serve --root www=/var/www --root home=~ --tls-cert c.pem --tls-key k.pem
  remotedevplus user add eddy --admin
  remotedevplus user perms ana module:git git:read module:search
  remotedevplus user perms luis dev
  remotedevplus user roots eddy /            # el super admin ve todo el disco

Roles (paquetes de permisos): ${Object.keys(ROLES).join(', ')}
`;

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const has = (argv, name) => argv.includes(name);

async function prompt(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Se intercepta la escritura al TTY para que la contraseña no quede en
    // pantalla ni en el scrollback de la terminal.
    rl.output.write(question);
    rl._writeToOutput = () => {};
  }
  const answer = await new Promise((resolve) => rl.question(hidden ? '' : question, resolve));
  if (hidden) rl.output.write('\n');
  rl.close();
  return answer;
}

async function readPassword() {
  const a = await prompt('Contraseña: ', { hidden: true });
  const b = await prompt('Repetir: ', { hidden: true });
  if (a !== b) throw new Error('Las contraseñas no coinciden');
  if (a.length < 8) throw new Error('La contraseña necesita al menos 8 caracteres');
  return a;
}

async function cmdServe(argv) {
  const cfg = loadConfig(argv);
  const services = createServices(cfg);
  const app = await buildServer(cfg, services);

  await app.listen({ port: cfg.port, host: cfg.host });
  const scheme = cfg.tls ? 'https' : 'http';
  const shown = cfg.host === '0.0.0.0' ? '<esta-máquina>' : cfg.host;

  console.log(`\n  remotedevplus  ${scheme}://${shown}:${cfg.port}${cfg.basePath === '/' ? '' : cfg.basePath}`);
  console.log('  raíces:');
  for (const r of cfg.roots) console.log(`    ${r.name.padEnd(12)} ${r.path}`);
  if (!services.auth.hasUsers()) {
    console.log('\n  ⚠  No hay usuarios. Cree el primero en otra terminal:');
    console.log('       npm run user -- add <nombre> --admin\n');
  }
  if (!cfg.tls && cfg.host !== '127.0.0.1' && !cfg.trustProxy) {
    console.log('\n  ⚠  Escuchando sin TLS en una interfaz no-loopback. Use --tls-cert/--tls-key');
    console.log('     o colóquelo detrás de un proxy: sin secure context el portapapeles no funciona.\n');
  }

  // Limpieza periódica de sesiones vencidas.
  const sweeper = setInterval(() => services.auth.sweep(), 3600_000);
  sweeper.unref();

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      console.log('\n  cerrando…');
      await app.close();
      process.exit(0);
    });
  }
}

async function cmdUser(argv) {
  const [sub, name, ...rest] = argv;
  const cfg = loadConfig([]);
  const { users, auth, db } = createServices(cfg);
  const done = () => db.close();

  const find = (n) => {
    const u = users.getByName(n);
    if (!u) throw new Error(`No existe el usuario ${n}`);
    return u;
  };

  switch (sub) {
    case 'list': {
      const list = users.list();
      if (!list.length) console.log('  (sin usuarios)');
      for (const u of list) {
        const perms = u.permissions.includes(ALL) ? 'super admin' : u.permissions.join(' ');
        console.log(`  ${String(u.id).padStart(3)}  ${u.username.padEnd(16)}` +
          `${u.disabled ? '[desactivado] ' : ''}${perms}`);
        console.log(`       ${describeRoots(u.roots)}`);
      }
      break;
    }
    case 'add': {
      if (!name) throw new Error('Falta el nombre de usuario');
      const password = flag(rest, '--password') || await readPassword();
      const permissions = has(rest, '--admin')
        ? [ALL]
        : (flag(rest, '--role') || 'dev').split(',');
      const roots = rest.filter((a, i) => rest[i - 1] === '--root');
      // El CLI corre sin sesión, así que actúa como super admin: quien tiene la
      // base en el disco ya puede todo.
      const u = await users.create({
        username: name, password, displayName: flag(rest, '--name'), permissions, roots,
      }, ROOT_ACTOR);
      console.log(`  creado: ${u.username} (${u.permissions.includes(ALL) ? 'super admin' : u.permissions.join(' ')})`);
      break;
    }
    case 'passwd': {
      const u = find(name);
      await users.setPassword(u.id, flag(rest, '--password') || await readPassword());
      auth.logoutAll(u.id);
      console.log(`  contraseña cambiada para ${u.username}; sus sesiones quedaron cerradas`);
      break;
    }
    case 'perms': {
      const u = find(name);
      if (!rest.length) {
        console.log(`  ${u.username}: ${u.permissions.join(' ')}`);
        console.log(`  disponibles: ${PERMISSIONS.join(' ')}`);
        console.log(`  roles: ${Object.keys(ROLES).join(' ')}`);
        break;
      }
      const out = users.setPermissions(u.id, rest.includes('--admin') ? [ALL] : rest);
      console.log(`  ${out.username}: ${out.permissions.join(' ')}`);
      break;
    }
    case 'roots': {
      const u = find(name);
      const paths = rest.filter((a) => !a.startsWith('-'));
      const out = await users.setRoots(u.id, paths, ROOT_ACTOR);
      console.log(`  ${out.username}: ${describeRoots(out.roots)}`);
      break;
    }
    case 'disable':
    case 'enable': {
      const u = find(name);
      users.setDisabled(u.id, sub === 'disable');
      if (sub === 'disable') auth.logoutAll(u.id);
      console.log(`  ${u.username} ${sub === 'disable' ? 'desactivado (sesiones cerradas)' : 'reactivado'}`);
      break;
    }
    case 'rm': {
      const u = find(name);
      users.remove(u.id);
      auth.logoutAll(u.id);
      console.log(`  eliminado: ${u.username}`);
      break;
    }
    default:
      console.log(USAGE);
      process.exitCode = sub ? 1 : 0;
  }
  done();
}

const [cmd, ...argv] = process.argv.slice(2);
try {
  if (cmd === 'serve') await cmdServe(argv);
  else if (cmd === 'user') await cmdUser(argv);
  else {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
  }
} catch (err) {
  console.error(`\n  error: ${err.message}\n`);
  process.exitCode = 1;
}
