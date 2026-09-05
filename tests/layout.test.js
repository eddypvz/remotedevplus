import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAlArrancar } from '../apps/web/src/stores/pestanaNavegador.ts';

/**
 * El panel del sidebar sigue a la pestaña activa.
 *
 * La regla se prueba sola, sin montar Vue: es una decisión de tres líneas pero
 * fácil de romper al agregar un panel nuevo, y el síntoma —ver la lista de
 * conversaciones de Claude mientras se mira git— es de los que se toleran en
 * vez de reportarse.
 */
const PANELES = {
  explorer: { id: 'explorer' },
  search: { id: 'search' },
  settings: { id: 'settings' },
  claude: { id: 'claude', owner: 'claude-native' },
};

function seguir(panelActual, moduleId, activoOculta = false) {
  if (!moduleId) return panelActual;
  const p = PANELES[panelActual];
  if (!p?.owner || p.owner === moduleId) return panelActual;
  // Solo cede si la barra de todos modos va a estar oculta.
  return activoOculta ? 'explorer' : panelActual;
}

/**
 * El sidebar se oculta solo donde el módulo lo pide.
 *
 * Esto ya se revirtió una vez por aplicarlo a todos los módulos a pantalla
 * completa. El test fija la regla actual para que no vuelva a generalizarse
 * sin querer al agregar un módulo nuevo.
 */
const MODULOS = {
  git: { fullWidth: true, ocultaBarra: true },
  'claude-native': { fullWidth: true },
  file: {},
  terminal: {},
};

function sidebarVisible(quiereUsuario, moduleId) {
  const m = moduleId ? MODULOS[moduleId] : null;
  return quiereUsuario && !m?.ocultaBarra;
}

describe('cuándo se ve el sidebar', () => {
  test('git lo oculta aunque el usuario lo quiera', () => {
    assert.equal(sidebarVisible(true, 'git'), false);
  });

  test('los demás módulos a pantalla completa NO lo ocultan', () => {
    assert.equal(sidebarVisible(true, 'claude-native'), true,
      'se probó ocultarlo también acá y estorbaba');
  });

  test('la intención del usuario se respeta fuera de git', () => {
    for (const m of ['claude-native', 'file', 'terminal', null]) {
      assert.equal(sidebarVisible(true, m), true);
      assert.equal(sidebarVisible(false, m), false);
    }
  });

  test('al salir de git vuelve como estaba', () => {
    // La intención no se toca al entrar, así que salir la recupera sola.
    const quiere = true;
    assert.equal(sidebarVisible(quiere, 'git'), false);
    assert.equal(sidebarVisible(quiere, 'file'), true);
  });
});

/**
 * Qué hace un icono de panel del rail.
 *
 * La regla es una sola: cambiar de pestaña solo pasa cuando la barra no se
 * puede mostrar de otro modo. Fuera de eso, un icono de panel solo abre su
 * panel — que es lo que permite mirar archivos sin salir de una conversación.
 */
function tocarPanel({ moduleId, hayPestana, activoOculta }) {
  if (!activoOculta) return 'solo abre el panel';
  if (moduleId && hayPestana) return 'enfoca la pestaña';
  return 'suelta la activa';
}

describe('tocar un icono de panel', () => {
  test('desde Claude, el explorador se abre sin salir de la conversación', () => {
    assert.equal(
      tocarPanel({ moduleId: 'file', hayPestana: true, activoOculta: false }),
      'solo abre el panel',
      'mirar archivos mientras se conversa es el flujo, no una excepción',
    );
  });

  test('desde un archivo, el panel de Claude se abre sin cerrar el archivo', () => {
    assert.equal(
      tocarPanel({ moduleId: 'claude-native', hayPestana: true, activoOculta: false }),
      'solo abre el panel',
    );
  });

  test('el buscador se abre desde cualquier módulo que muestre la barra', () => {
    for (const activoOculta of [false]) {
      assert.equal(tocarPanel({ moduleId: undefined, hayPestana: false, activoOculta }),
        'solo abre el panel');
    }
  });

  test('desde git, con pestaña de ese módulo, va a ella', () => {
    assert.equal(
      tocarPanel({ moduleId: 'file', hayPestana: true, activoOculta: true }),
      'enfoca la pestaña',
    );
  });

  test('desde git, sin pestaña, suelta git para que se vea la barra', () => {
    assert.equal(
      tocarPanel({ moduleId: 'file', hayPestana: false, activoOculta: true }),
      'suelta la activa',
    );
    assert.equal(
      tocarPanel({ moduleId: undefined, hayPestana: false, activoOculta: true }),
      'suelta la activa',
      'el buscador tampoco puede quedar invisible',
    );
  });
});

describe('el panel sigue a la pestaña', () => {
  test('un panel con dueño se retira solo al entrar donde la barra se oculta', () => {
    assert.equal(seguir('claude', 'git', true), 'explorer');
  });

  test('pero NO se retira al pasar a un archivo o un terminal', () => {
    assert.equal(seguir('claude', 'file'), 'claude',
      'volver a un archivo no debe llevarse el panel de conversaciones');
    assert.equal(seguir('claude', 'terminal'), 'claude');
  });

  test('pero se queda mientras su módulo está en foco', () => {
    assert.equal(seguir('claude', 'claude-native'), 'claude');
  });

  test('los paneles sin dueño no se mueven nunca', () => {
    for (const m of ['git', 'claude-native', 'file', 'terminal']) {
      assert.equal(seguir('explorer', m), 'explorer');
      assert.equal(seguir('search', m), 'search');
      assert.equal(seguir('settings', m), 'settings');
    }
  });

  test('sin pestaña activa no se toca nada', () => {
    assert.equal(seguir('claude', null), 'claude', 'cerrar la última pestaña no se lleva el panel');
    assert.equal(seguir('settings', null), 'settings');
  });
});

/**
 * A dónde va el foco al cerrar una pestaña.
 *
 * La regla se prueba sola porque ya se equivocó una vez: caer a la vecina por
 * posición manda a otro módulo, y cerrar el último archivo terminaba en git.
 */
function trasCerrar(lista, cerradaIdx) {
  const cerrada = lista[cerradaIdx];
  const resto = lista.filter((_, i) => i !== cerradaIdx);
  const hermanas = resto.filter((t) => t.moduleId === cerrada.moduleId);
  if (!hermanas.length) return null;
  return hermanas.reduce((mejor, t) => {
    const d = Math.abs(resto.indexOf(t) - cerradaIdx);
    return d < Math.abs(resto.indexOf(mejor) - cerradaIdx) ? t : mejor;
  }).key;
}

describe('el foco al cerrar una pestaña', () => {
  const t = (key, moduleId) => ({ key, moduleId });

  test('con otra del mismo módulo, va a la más cercana', () => {
    const lista = [t('f1', 'file'), t('f2', 'file'), t('g1', 'git')];
    assert.equal(trasCerrar(lista, 0), 'f2');
  });

  test('sin otra del mismo módulo, no enfoca nada', () => {
    const lista = [t('f1', 'file'), t('g1', 'git')];
    assert.equal(trasCerrar(lista, 0), null,
      'cerrar el último archivo no debe mandar a git');
  });

  test('nunca salta a otro módulo aunque sea el vecino', () => {
    const lista = [t('g1', 'git'), t('f1', 'file'), t('c1', 'claude-native')];
    assert.equal(trasCerrar(lista, 1), null);
  });

  test('cerrar la última pestaña deja todo sin foco', () => {
    assert.equal(trasCerrar([t('f1', 'file')], 0), null);
  });

  test('elige la hermana más cercana, no la primera', () => {
    const lista = [t('f1', 'file'), t('g1', 'git'), t('f2', 'file'), t('f3', 'file')];
    assert.equal(trasCerrar(lista, 3), 'f2');
  });
});

describe('un proyecto por pestaña del navegador', () => {
  /**
   * Dos pestañas del mismo navegador comparten `localStorage`, así que elegir
   * workspace en una lo cambiaba en la otra y trabajar en dos proyectos a la vez
   * era imposible. La regla: lo que esta pestaña ya tenía manda siempre; lo
   * último elegido en cualquier pestaña solo se adopta si nadie más lo usa.
   */
  const libre = () => false;
  const tomado = () => true;

  test('una recarga vuelve al proyecto de esta pestaña, tomado o no', () => {
    // `propio` gana incluso si otra pestaña también lo tiene: es una recarga,
    // no una pestaña nueva, y sacarle su proyecto sería peor.
    assert.equal(workspaceAlArrancar(7, 3, libre), 7);
    assert.equal(workspaceAlArrancar(7, 3, tomado), 7);
  });

  test('una pestaña nueva adopta el último si está libre', () => {
    // Es lo que hace que reabrir el navegador caiga donde estabas.
    assert.equal(workspaceAlArrancar(null, 3, libre), 3);
  });

  test('una pestaña nueva pregunta si el último ya está abierto', () => {
    // El caso que motivó todo: abrir una segunda pestaña ofrece elegir otro
    // proyecto en vez de duplicar el primero.
    assert.equal(workspaceAlArrancar(null, 3, tomado), null);
  });

  test('sin nada guardado, pregunta', () => {
    assert.equal(workspaceAlArrancar(null, null, libre), null);
  });
});
