#!/usr/bin/env node
// Levanta el agente y Vite juntos. El agente sirve la API y el WS; Vite sirve
// la web con recarga en caliente y proxea /api y /ws hacia el agente.
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);

const children = [
  spawn(process.execPath, ['apps/agent/src/cli.js', 'serve', ...args], { cwd: root, stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', '@remotedevplus/web'], { cwd: root, stdio: 'inherit' }),
];

const stop = () => { for (const c of children) c.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => { if (code) stop(); });
