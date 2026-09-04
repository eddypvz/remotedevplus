import type { Component } from 'vue';
import type { Permission } from '@remotedevplus/protocol';

/**
 * Todo lo que ocupa el Workbench es un módulo, y todos cumplen este contrato.
 * Es lo que hace que agregar el gestor de git o el de base de datos no toque
 * el layout: se registran acá y aparecen.
 */
export interface ModuleDef {
  id: string;
  /** Permiso sin el cual el módulo no se registra ni aparece en el rail. */
  requires?: Permission;
  /**
   * Ocupa todo el workbench en vez de ser una columna angosta. NO colapsa el
   * sidebar: eso se probó y estorbaba — el explorador se quiere abierto mientras
   * se usa Claude Code. Hoy es informativo: lo consultan los módulos que
   * necesiten saber si tienen la superficie completa.
   */
  fullWidth?: boolean;
  /**
   * Oculta el sidebar mientras este módulo está activo.
   *
   * Se probó una vez para TODOS los módulos a pantalla completa y estorbaba:
   * el explorador se quiere abierto mientras se usa Claude Code. Por eso ahora
   * se declara módulo por módulo, y solo lo pide el que ya cubre por su cuenta
   * lo que el sidebar ofrecería — git elige su carpeta al abrirse, así que el
   * explorador al costado no aporta y le quita ancho al árbol.
   *
   * No oculta el rail: sin él no habría cómo cambiar de módulo.
   */
  ocultaBarra?: boolean;
  /** Solo una pestaña de este módulo a la vez. */
  singleton?: boolean;
  /**
   * Necesita un directorio de trabajo. Si el workspace tiene más de una
   * carpeta, al lanzarlo desde el rail se pregunta cuál — un workspace con
   * backend y frontend no tiene un cwd obvio.
   */
  needsFolder?: boolean;
  icon: string;
  title: (ctx: TabContext) => string;
  subtitle?: (ctx: TabContext) => string | undefined;
  component: Component;
}

/** Contexto de una pestaña: qué archivo, qué sesión de terminal, etc. */
export interface TabContext {
  path?: string;
  sessionId?: string;
  kind?: string;
  [k: string]: unknown;
}

export interface Tab {
  /** Identidad estable de la pestaña; sobrevive reordenar y recargar. */
  key: string;
  moduleId: string;
  ctx: TabContext;
}

/** Panel del SideBar: lo que abre un icono de tipo `panel`. */
export interface PanelDef {
  id: string;
  label: string;
  icon: string;
  requires?: Permission;
  /**
   * El módulo al que pertenece este panel, si es de uno solo.
   *
   * Un panel con dueño solo tiene sentido mientras su módulo está en foco: la
   * lista de conversaciones de Claude no dice nada mientras se mira git. Los
   * paneles sin dueño —explorador, buscador, ajustes— sirven siempre y se
   * quedan donde estén.
   */
  owner?: string;
  component: Component;
}

/**
 * Los iconos del rail tienen dos comportamientos, y esa distinción es el
 * corazón de la UI:
 *  - `panel`    → togglea el SideBar (explorador, buscador, config)
 *  - `launcher` → abre una PESTAÑA a pantalla completa (git, claude, db)
 * Por eso el gestor de git no es un panel angosto al costado, que es el error
 * que se está corrigiendo respecto de VS Code.
 */
export interface ActivityItem {
  id: string;
  label: string;
  icon: string;
  kind: 'panel' | 'launcher';
  requires?: Permission;
  /** Para `launcher`: qué módulo abre. */
  moduleId?: string;
  /** Posición en el rail. */
  slot?: 'top' | 'bottom';
}
