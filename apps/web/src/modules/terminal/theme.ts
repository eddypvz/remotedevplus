import type { ITheme } from '@xterm/xterm';
import type { ResolvedTheme } from '../../stores/settings';

/**
 * xterm pinta en canvas/WebGL, así que no lee variables CSS: su paleta hay que
 * pasársela en JS y actualizarla a mano cuando cambia el tema.
 *
 * Los 16 colores ANSI del claro son los de VS Code Light+, para que la salida
 * de un comando se vea igual que en la terminal integrada de VS Code.
 */
const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#3b3b3b',
  cursor: '#005fb8',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800',
  blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14',
  brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc',
  brightCyan: '#0598bc', brightWhite: '#a5a5a5',
};

const DARK: ITheme = {
  background: '#14161a',
  foreground: '#d7dce4',
  cursor: '#5aa2ff',
  cursorAccent: '#14161a',
  selectionBackground: '#2f4f7d99',
  black: '#14161a', red: '#f2777a', green: '#56d364', yellow: '#e3b341',
  blue: '#5aa2ff', magenta: '#c99aff', cyan: '#5ad4e6', white: '#d7dce4',
  brightBlack: '#5c6472', brightRed: '#ff8f92', brightGreen: '#7ee787',
  brightYellow: '#f0ca6a', brightBlue: '#84bbff', brightMagenta: '#dbb2ff',
  brightCyan: '#7ee3f0', brightWhite: '#ffffff',
};

export function terminalTheme(resolved: ResolvedTheme): ITheme {
  return resolved === 'dark' ? DARK : LIGHT;
}
