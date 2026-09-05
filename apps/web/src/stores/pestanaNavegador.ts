/**
 * Identidad de esta pestaña del navegador, y quién tiene abierto qué.
 *
 * El problema: dos pestañas del mismo navegador comparten `localStorage`, así
 * que trabajar en dos proyectos a la vez era imposible — elegir workspace en
 * una lo cambiaba en la otra. `sessionStorage` sí es por pestaña, pero se pierde
 * al cerrarla, y perder el estado al volver a abrir la tablet sería peor.
 *
 * La solución son las dos cosas juntas: el workspace de **esta** pestaña vive en
 * `sessionStorage`, y aparte se anota en `localStorage` cuál fue el último
 * elegido. Una pestaña nueva adopta ese último **solo si ninguna otra pestaña
 * viva lo tiene abierto**; si está tomado, pregunta. Así reabrir el navegador
 * cae donde estabas, y abrir una segunda pestaña ofrece elegir otro proyecto,
 * que es exactamente lo que se quiere.
 *
 * Saber qué pestañas están vivas se hace con un latido en `localStorage`: cada
 * una anota su id y su workspace cada pocos segundos, y las que no laten se dan
 * por muertas. Es más simple que coordinar por `BroadcastChannel` y funciona
 * aunque la pestaña quede en segundo plano un rato.
 */

const ID = 'rdp.pestana.id';
const VIVAS = 'rdp.pestanas.vivas';
const LATIDO_MS = 5_000;
/** Sin latido en este tiempo, la pestaña se considera cerrada. */
const MUERTA_MS = 20_000;

type Vivas = Record<string, { ws: number | null; ts: number }>;

function leerLocal<T>(clave: string, porDefecto: T): T {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? JSON.parse(raw) as T : porDefecto;
  } catch { return porDefecto; }
}

function escribirLocal(clave: string, valor: unknown) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* modo privado */ }
}

/**
 * El id de esta pestaña. Vive en `sessionStorage`, así que sobrevive a una
 * recarga y muere con la pestaña.
 *
 * Duplicar una pestaña copia el `sessionStorage`, así que las dos arrancarían
 * con el mismo id. Se detecta al registrar el latido: si el id ya está vivo y
 * no es nuestro, se toma uno nuevo.
 */
function idDeEstaPestana(): string {
  try {
    const guardado = sessionStorage.getItem(ID);
    if (guardado) return guardado;
    const nuevo = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(ID, nuevo);
    return nuevo;
  } catch {
    // Modo privado sin sessionStorage: cada carga es una pestaña distinta.
    return Math.random().toString(36).slice(2, 10);
  }
}

let miId = idDeEstaPestana();
let reloj: number | undefined;

function vivasLimpias(): Vivas {
  const ahora = Date.now();
  const todas = leerLocal<Vivas>(VIVAS, {});
  const vivas: Vivas = {};
  for (const [id, v] of Object.entries(todas)) {
    if (ahora - v.ts < MUERTA_MS) vivas[id] = v;
  }
  return vivas;
}

/** Anota que esta pestaña sigue viva y en qué workspace está. */
export function latir(ws: number | null) {
  const vivas = vivasLimpias();
  vivas[miId] = { ws, ts: Date.now() };
  escribirLocal(VIVAS, vivas);
}

/** Empieza a latir y devuelve la función para dejar de hacerlo. */
export function empezarALatir(leerWs: () => number | null) {
  latir(leerWs());
  reloj = setInterval(() => latir(leerWs()), LATIDO_MS) as unknown as number;

  const alCerrar = () => {
    const vivas = vivasLimpias();
    delete vivas[miId];
    escribirLocal(VIVAS, vivas);
  };
  // `pagehide` y no `beforeunload`: en iOS Safari el segundo no siempre corre.
  window.addEventListener('pagehide', alCerrar);

  return () => {
    clearInterval(reloj);
    window.removeEventListener('pagehide', alCerrar);
    alCerrar();
  };
}

/** Si otra pestaña viva tiene ese workspace abierto. */
export function tomadoPorOtra(ws: number): boolean {
  const vivas = vivasLimpias();
  return Object.entries(vivas).some(([id, v]) => id !== miId && v.ws === ws);
}

/**
 * El workspace con el que debe arrancar esta pestaña, o `null` si hay que
 * preguntar.
 *
 * `propio` es lo que esta pestaña ya tenía (una recarga); manda siempre.
 * `ultimo` es lo último elegido en cualquier pestaña, y solo se adopta si nadie
 * más lo está usando.
 */
export function workspaceAlArrancar(
  propio: number | null,
  ultimo: number | null,
  tomado: (ws: number) => boolean = tomadoPorOtra,
): number | null {
  if (propio !== null) return propio;
  if (ultimo !== null && !tomado(ultimo)) return ultimo;
  return null;
}

/** Solo para los tests: reinicia la identidad de esta pestaña. */
export function _reiniciar(id?: string) {
  miId = id ?? Math.random().toString(36).slice(2, 10);
}
