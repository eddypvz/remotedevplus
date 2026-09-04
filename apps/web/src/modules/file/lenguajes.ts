import type { LanguageSupport } from '@codemirror/language';

/**
 * Gramáticas por extensión, cargadas bajo demanda.
 *
 * Cada una es su propio chunk: abrir un `.php` no descarga la de Python. Sin
 * esto el visor arrastraría todas las gramáticas en el arranque.
 */
const CARGA: Record<string, () => Promise<LanguageSupport>> = {
  js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  mjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  cjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  ts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })),
  vue: () => import('@codemirror/lang-vue').then((m) => m.vue()),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  htm: () => import('@codemirror/lang-html').then((m) => m.html()),
  blade: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  scss: () => import('@codemirror/lang-css').then((m) => m.css()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  md: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  yml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
};

/** Nombre legible, para la barra de estado. */
const NOMBRES: Record<string, string> = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JSX',
  ts: 'TypeScript', tsx: 'TSX', vue: 'Vue', php: 'PHP',
  html: 'HTML', htm: 'HTML', blade: 'Blade', css: 'CSS', scss: 'SCSS',
  json: 'JSON', md: 'Markdown', markdown: 'Markdown', sql: 'SQL',
  py: 'Python', yml: 'YAML', yaml: 'YAML',
};

export const extensionDe = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';
export const nombreLenguaje = (path: string) => NOMBRES[extensionDe(path)] ?? 'Texto';

export async function lenguajeDe(path: string): Promise<LanguageSupport | null> {
  const carga = CARGA[extensionDe(path)];
  if (!carga) return null;
  try {
    return await carga();
  } catch {
    // Sin gramática se sigue editando en texto plano; no es motivo para fallar.
    return null;
  }
}
