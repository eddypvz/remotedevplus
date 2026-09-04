<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from './markdown';

const props = defineProps<{ source: string }>();
const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- el HTML pasa por DOMPurify -->
  <div class="md" v-html="html" />
</template>

<style scoped>
.md { font-size: inherit; line-height: 1.65; overflow-wrap: anywhere; }

.md :deep(> *:first-child) { margin-top: 0; }
.md :deep(> *:last-child) { margin-bottom: 0; }
.md :deep(p) { margin: 0 0 .7em; }

.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) {
  margin: 1.3em 0 .5em; line-height: 1.3; font-weight: 650;
}
.md :deep(h1) { font-size: 1.32em; }
.md :deep(h2) { font-size: 1.18em; }
.md :deep(h3) { font-size: 1.06em; }
.md :deep(h4) { font-size: 1em; color: var(--fg-dim); }

.md :deep(ul), .md :deep(ol) { margin: 0 0 .7em; padding-left: 1.4em; }
.md :deep(li) { margin: .22em 0; }
.md :deep(li > p) { margin: 0; }

.md :deep(code) {
  padding: .12em .38em; border-radius: 4px;
  background: var(--bg-surface); border: 1px solid var(--border);
  font: .88em var(--mono); overflow-wrap: anywhere;
}
.md :deep(pre) {
  margin: 0 0 .8em; padding: 11px 13px; overflow-x: auto;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 9px;
}
.md :deep(pre code) {
  padding: 0; border: 0; background: none;
  font-size: .92em; line-height: 1.55; white-space: pre;
}

.md :deep(blockquote) {
  margin: 0 0 .8em; padding: .1em 0 .1em .9em;
  border-left: 2px solid var(--border-strong); color: var(--fg-dim);
}

.md :deep(a) { color: var(--accent); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }

.md :deep(table) {
  margin: 0 0 .8em; border-collapse: collapse; display: block; overflow-x: auto;
  font-size: .94em;
}
.md :deep(th), .md :deep(td) {
  padding: 5px 10px; border: 1px solid var(--border); text-align: left;
}
.md :deep(th) { background: var(--bg-surface); font-weight: 600; }

.md :deep(hr) { margin: 1.1em 0; border: 0; border-top: 1px solid var(--border); }
.md :deep(strong) { font-weight: 650; }
.md :deep(img) { max-width: 100%; border-radius: 8px; }
</style>
