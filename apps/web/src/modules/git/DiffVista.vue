<script setup lang="ts">
import { computed } from 'vue';

/**
 * Un diff unificado, coloreado.
 *
 * Se parsea acá y no se pinta el texto crudo porque lo que uno busca en un diff
 * son las líneas que cambian: sin color hay que leer los signos uno por uno.
 * Las cabeceras de trozo se marcan aparte para poder saltar entre ellas.
 */
const props = defineProps<{ diff: string }>();

interface Linea { tipo: 'suma' | 'resta' | 'contexto' | 'trozo' | 'meta'; texto: string }

const lineas = computed<Linea[]>(() => (
  props.diff.split('\n').map((l) => {
    if (l.startsWith('@@')) return { tipo: 'trozo' as const, texto: l };
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ')
      || l.startsWith('index ') || l.startsWith('new file') || l.startsWith('deleted file')
      || l.startsWith('similarity ') || l.startsWith('rename ')) {
      return { tipo: 'meta' as const, texto: l };
    }
    if (l[0] === '+') return { tipo: 'suma' as const, texto: l };
    if (l[0] === '-') return { tipo: 'resta' as const, texto: l };
    return { tipo: 'contexto' as const, texto: l };
  })
));

const resumen = computed(() => ({
  mas: lineas.value.filter((l) => l.tipo === 'suma').length,
  menos: lineas.value.filter((l) => l.tipo === 'resta').length,
}));
</script>

<template>
  <div class="diff">
    <p class="resumen">
      <span class="mas">+{{ resumen.mas }}</span>
      <span class="menos">−{{ resumen.menos }}</span>
    </p>
    <pre><code><span
      v-for="(l, i) in lineas" :key="i" class="l" :class="l.tipo"
    >{{ l.texto || ' ' }}
</span></code></pre>
  </div>
</template>

<style scoped>
.diff { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.resumen {
  display: flex; gap: 10px; flex: 0 0 auto; margin: 0;
  padding: 5px 12px; border-bottom: 1px solid var(--border);
  font: 11px var(--mono);
}
.mas { color: var(--ok); }
.menos { color: var(--danger); }

pre { flex: 1; min-height: 0; margin: 0; overflow: auto; }
code { display: block; font: 12px/1.55 var(--mono); }
.l { display: block; padding: 0 12px; white-space: pre; }
.l.suma { background: color-mix(in oklab, var(--ok) 14%, transparent); color: var(--fg); }
.l.resta { background: color-mix(in oklab, var(--danger) 14%, transparent); color: var(--fg); }
.l.contexto { color: var(--fg-dim); }
.l.trozo {
  background: var(--bg-surface); color: var(--accent);
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.l.meta { color: var(--fg-faint); }
</style>
