#!/usr/bin/env node
/**
 * Fotografía de la superficie del Claude Agent SDK.
 *
 * El SDK se mueve rápido y está en 0.x, así que una actualización puede agregar
 * capacidades que valga la pena usar o cambiar algo de lo que ya usamos. Leer el
 * changelog a mano no escala; esto extrae la superficie de los .d.ts y la
 * compara con la foto guardada, para responder dos preguntas de un vistazo:
 * qué apareció y qué se movió de lo que tocamos.
 *
 *   npm run sdk:check     compara con la foto guardada
 *   npm run sdk:snapshot  guarda la foto actual
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const SDK = join(RAIZ, 'node_modules/@anthropic-ai/claude-agent-sdk');
const FOTO = join(RAIZ, 'docs/sdk-surface.json');

/** Todo el código nuestro, para saber qué del SDK usamos de verdad. */
function nuestroCodigo() {
  const partes = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.(js|ts|vue|mjs)$/.test(e)) partes.push(readFileSync(p, 'utf8'));
    }
  };
  for (const d of ['apps', 'packages', 'tests']) recorrer(join(RAIZ, d));
  return partes.join('\n');
}

function extraer() {
  const dts = readFileSync(join(SDK, 'sdk.d.ts'), 'utf8');
  const version = JSON.parse(readFileSync(join(SDK, 'package.json'), 'utf8')).version;

  const funciones = [...dts.matchAll(/^export declare function (\w+)/gm)].map((m) => m[1]);

  // Los campos de Options son el grueso de lo configurable.
  const iOptions = dts.indexOf('export declare type Options = {');
  const bloque = iOptions >= 0 ? dts.slice(iOptions, dts.indexOf('\n};', iOptions)) : '';
  const opciones = [...bloque.matchAll(/^ {4}(\w+)\??:/gm)].map((m) => m[1]);

  const iQuery = dts.indexOf('export declare interface Query extends');
  const bq = iQuery >= 0 ? dts.slice(iQuery, dts.indexOf('\n}', iQuery)) : '';
  const metodosQuery = [...bq.matchAll(/^ {4}(\w+)\(/gm)].map((m) => m[1]);

  const union = dts.match(/^export declare type SDKMessage = ([^;]+);/m)?.[1] ?? '';
  const mensajes = union.split('|').map((x) => x.trim()).filter(Boolean);

  const modos = (dts.match(/^export declare type PermissionMode = ([^;]+);/m)?.[1] ?? '')
    .split('|').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);

  const herramientas = [...dts.matchAll(/^export declare type (\w*Hook\w*Input) =/gm)].map((m) => m[1]);

  return { version, funciones, opciones, metodosQuery, mensajes, modos, hooks: herramientas };
}

function usados(surface, codigo) {
  const usa = (nombre) => new RegExp(`\\b${nombre}\\b`).test(codigo);
  return {
    funciones: surface.funciones.filter(usa),
    opciones: surface.opciones.filter(usa),
    metodosQuery: surface.metodosQuery.filter(usa),
  };
}

function diferencia(antes, ahora, clave) {
  const a = new Set(antes?.[clave] ?? []);
  const b = new Set(ahora[clave] ?? []);
  return {
    nuevos: [...b].filter((x) => !a.has(x)),
    quitados: [...a].filter((x) => !b.has(x)),
  };
}

const surface = extraer();
surface.usamos = usados(surface, nuestroCodigo());

const modo = process.argv[2] ?? 'check';

if (modo === 'snapshot') {
  writeFileSync(FOTO, JSON.stringify(surface, null, 2) + '\n');
  console.log(`  foto guardada: SDK ${surface.version}`);
  console.log(`  ${surface.opciones.length} opciones, ${surface.funciones.length} funciones, ${surface.mensajes.length} tipos de mensaje`);
  console.log(`  usamos ${surface.usamos.opciones.length} opciones y ${surface.usamos.funciones.length} funciones`);
  process.exit(0);
}

if (!existsSync(FOTO)) {
  console.error('  No hay foto guardada. Corré: npm run sdk:snapshot');
  process.exit(1);
}
const antes = JSON.parse(readFileSync(FOTO, 'utf8'));

if (antes.version === surface.version) {
  console.log(`  SDK ${surface.version}: sin cambios de versión.`);
  process.exit(0);
}

console.log(`\n  SDK ${antes.version} → ${surface.version}\n`);

const secciones = [
  ['opciones', 'Opciones de query()'],
  ['funciones', 'Funciones exportadas'],
  ['metodosQuery', 'Métodos de Query'],
  ['mensajes', 'Tipos de SDKMessage'],
  ['modos', 'Modos de permiso'],
];

let rompeAlgo = false;
for (const [clave, titulo] of secciones) {
  const d = diferencia(antes, surface, clave);
  if (!d.nuevos.length && !d.quitados.length) continue;
  console.log(`  ${titulo}`);
  for (const x of d.nuevos) console.log(`    \x1b[32m+ ${x}\x1b[0m`);
  for (const x of d.quitados) {
    // Lo que desaparece y además usábamos es lo único urgente.
    const loUsabamos = (antes.usamos?.[clave] ?? []).includes(x);
    if (loUsabamos) rompeAlgo = true;
    console.log(`    \x1b[31m- ${x}\x1b[0m${loUsabamos ? '  \x1b[41m ¡LO USÁBAMOS! \x1b[0m' : ''}`);
  }
  console.log('');
}

console.log(rompeAlgo
  ? '  \x1b[31mDesapareció algo que usamos: hay que revisar antes de actualizar.\x1b[0m\n'
  : '  Nada de lo que usamos desapareció.\n');
console.log('  Para aceptar los cambios: npm run sdk:snapshot\n');
process.exit(rompeAlgo ? 1 : 0);
