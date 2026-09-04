import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * El editor toma los colores de los tokens CSS del tema.
 *
 * No se usa un tema empaquetado de CodeMirror porque tendría su propia paleta y
 * el editor se vería como un recuadro ajeno dentro de la aplicación. Y así los
 * dos temas salen del mismo lugar que el resto.
 */
const base = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', color: 'var(--fg)', height: '100%' },
  '.cm-content': { caretColor: 'var(--accent)', fontFamily: 'var(--mono)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--fg-faint)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-dim)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklab, var(--accent) 25%, transparent) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in oklab, var(--accent) 30%, transparent) !important' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--warn) 35%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--warn) 60%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--fg)', borderColor: 'var(--border)' },
  '.cm-panel input, .cm-panel button': {
    backgroundColor: 'var(--bg)', color: 'var(--fg)',
    border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '2px 6px',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-surface)', color: 'var(--fg-dim)',
    border: '1px solid var(--border)', borderRadius: '4px', padding: '0 5px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-panel)', color: 'var(--fg)',
    border: '1px solid var(--border-strong)', borderRadius: '8px',
  },
  // El objetivo táctil del plegado es diminuto por defecto.
  '.cm-foldGutter span': { padding: '0 4px', fontSize: '11px' },
});

/**
 * Los colores de sintaxis salen de variables CSS, así que cambian solos con el
 * tema sin recrear el editor.
 */
const resaltado = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--fg)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--fg-dim)' },
  { tag: [t.heading, t.strong], color: 'var(--syn-keyword)', fontWeight: '650' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: [t.invalid], color: 'var(--danger)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--fg-faint)' },
]);

export const temaEditor: Extension = [base, syntaxHighlighting(resaltado)];
