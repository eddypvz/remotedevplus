<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../ui/Icon.vue';
import type { GitCommit } from '../../stores/git';

/**
 * El árbol de commits.
 *
 * Una fila por commit, con un SVG del ancho de los carriles a la izquierda. El
 * agente ya calculó qué carril ocupa cada commit, cuáles pasan de largo y hacia
 * dónde salen sus padres, así que acá solo se dibuja: no hay que recorrer el
 * grafo en cada pintado.
 *
 * Las curvas son bezier y no diagonales rectas porque con muchas ramas las
 * rectas se confunden entre sí; la curva deja ver de dónde sale cada línea.
 */
const props = defineProps<{
  commits: GitCommit[];
  ancho: number;
  seleccionado: string | null;
}>();
const emit = defineEmits<{ (e: 'elegir', hash: string): void }>();

const CARRIL = 15;
const FILA = 34;

const anchoSvg = computed(() => Math.max(2, props.ancho) * CARRIL + 8);
const x = (carril: number) => carril * CARRIL + CARRIL / 2 + 4;

/** Un color estable por carril: el mismo carril mantiene su color al hacer scroll. */
const COLORES = [
  'var(--accent)', '#e3a13a', '#56d364', '#c99aff',
  '#5ad4e6', '#f2777a', '#84bbff', '#e6c84a',
];
const color = (carril: number) => COLORES[carril % COLORES.length];

/** Una curva del carril de origen al de destino, entrando o saliendo de la fila. */
function curva(desde: number, hasta: number, haciaAbajo: boolean) {
  const x1 = x(desde);
  const x2 = x(hasta);
  const yMedio = FILA / 2;
  const yFin = haciaAbajo ? FILA : 0;
  const control = haciaAbajo ? yMedio + FILA / 3 : yMedio - FILA / 3;
  return `M ${x1} ${yMedio} C ${x1} ${control}, ${x2} ${control}, ${x2} ${yFin}`;
}

type Clase = 'local' | 'remota' | 'etiqueta' | 'aqui';
interface Etiqueta { texto: string; clase: Clase }

const ICONO: Record<Clase, string> = {
  local: 'casa', remota: 'nube', etiqueta: 'etiqueta', aqui: 'aqui',
};

/**
 * Las referencias del commit.
 *
 * Cada una lleva su icono: casita si vive acá, nube si está en el remoto,
 * etiqueta si es un tag. El nombre completo se conserva —`origin/master` dice
 * de qué remoto es— pero el icono se lee sin leer, que es de lo que se trata
 * mirando un árbol.
 */
function etiquetas(c: GitCommit): Etiqueta[] {
  return c.refs
    .filter(Boolean)
    .map((r) => {
      /*
       * Un `HEAD` suelto significa HEAD desprendido: estás parado en este
       * commit y en ninguna rama. Antes se descartaba por venir sin flecha, y
       * el resultado era que tras un checkout a un commit viejo el árbol no
       * mostraba dónde estabas. Es justo cuando más falta hace saberlo.
       */
      if (r === 'HEAD') return { texto: 'HEAD', clase: 'aqui' as Clase };
      if (r.startsWith('tag: ')) return { texto: r.slice(5), clase: 'etiqueta' as Clase };
      const texto = r.replace('HEAD -> ', '');
      // Una rama remota siempre viene como <remoto>/<rama>; una local, no.
      return { texto, clase: texto.includes('/') ? 'remota' as Clase : 'local' as Clase };
    });
}
/** Dónde está parado el usuario: con rama (`HEAD -> x`) o desprendido (`HEAD`). */
const esCabeza = (c: GitCommit) => c.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD ->'));
const esFusion = (c: GitCommit) => c.parents.length > 1;

const cuando = (ms: number) => {
  const dias = Math.floor((Date.now() - ms) / 86400000);
  if (dias === 0) return new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (dias < 7) return `hace ${dias} d`;
  return new Date(ms).toLocaleDateString('es', { day: '2-digit', month: 'short' });
};
</script>

<template>
  <div class="grafo">
    <div
      v-for="c in commits" :key="c.hash"
      class="fila" :class="{ on: c.hash === seleccionado, aqui: esCabeza(c) }"
      :style="{ height: FILA + 'px' }"
      @click="emit('elegir', c.hash)"
    >
      <svg class="carriles" :width="anchoSvg" :height="FILA" aria-hidden="true">
        <!-- Las que solo pasan por acá: línea entera, sin nodo. -->
        <line
          v-for="l in c.cruzando" :key="`c${l}`"
          :x1="x(l)" y1="0" :x2="x(l)" :y2="FILA"
          :stroke="color(l)" stroke-width="2"
        />
        <!-- Lo que baja al nodo desde arriba. -->
        <line
          v-if="c.entraArriba"
          :x1="x(c.carril)" y1="0" :x2="x(c.carril)" :y2="FILA / 2"
          :stroke="color(c.carril)" stroke-width="2"
        />
        <!-- Ramas que convergen en este commit. -->
        <path
          v-for="l in c.entrantes" :key="`e${l}`"
          :d="curva(c.carril, l, false)" :stroke="color(l)" stroke-width="2" fill="none"
        />
        <!-- Hacia los padres. -->
        <template v-for="s in c.salidas" :key="`s${s.carril}`">
          <line
            v-if="s.carril === c.carril"
            :x1="x(c.carril)" :y1="FILA / 2" :x2="x(c.carril)" :y2="FILA"
            :stroke="color(c.carril)" stroke-width="2"
          />
          <path
            v-else :d="curva(c.carril, s.carril, true)"
            :stroke="color(s.carril)" stroke-width="2" fill="none"
          />
        </template>
        <circle
          :cx="x(c.carril)" :cy="FILA / 2" :r="esFusion(c) ? 5.5 : 4.5"
          :fill="esFusion(c) ? 'var(--bg)' : color(c.carril)"
          :stroke="color(c.carril)" stroke-width="2"
        />
      </svg>

      <div class="datos">
        <span v-if="etiquetas(c).length" class="refs">
          <span
            v-for="r in etiquetas(c)" :key="r.texto"
            class="ref" :class="[r.clase, { cabeza: esCabeza(c) && r.clase === 'local' }]"
          >
            <Icon :name="ICONO[r.clase]" :size="11" />
            {{ r.texto }}
          </span>
        </span>
        <span class="asunto">{{ c.asunto }}</span>
        <span class="autor">{{ c.autor }}</span>
        <span class="fecha">{{ cuando(c.fecha) }}</span>
        <span class="hash">{{ c.corto }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grafo { display: flex; flex-direction: column; }

.fila {
  display: flex; align-items: center; gap: 10px;
  padding-right: 12px; cursor: pointer;
}
.fila:hover { background: var(--bg-hover); }
.fila.on { background: color-mix(in oklab, var(--accent) 12%, transparent); }
/* Una marca al borde para encontrar dónde estás sin recorrer la lista. */
.fila.aqui { box-shadow: inset 3px 0 0 var(--accent); }

.carriles { flex: 0 0 auto; display: block; }

.datos {
  display: flex; align-items: center; gap: 10px;
  flex: 1; min-width: 0; font-size: 12.5px;
}
.refs { display: flex; gap: 4px; flex: 0 0 auto; }
.ref {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 20px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  font: 10.5px var(--mono); color: var(--fg-dim); white-space: nowrap;
}
.ref.cabeza { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.ref.remota { border-style: dashed; }
.ref.etiqueta { border-color: var(--warn); color: var(--warn); }
/* detached HEAD: se marca fuerte, porque es un estado del que hay que salir. */
.ref.aqui {
  background: var(--accent); border-color: var(--accent);
  color: #fff; font-weight: 650;
}
.ref :deep(svg) { opacity: .85; }

.asunto { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.autor { flex: 0 0 auto; max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--fg-faint); }
.fecha { flex: 0 0 auto; font-size: 11px; color: var(--fg-faint); font-variant-numeric: tabular-nums; }
.hash { flex: 0 0 auto; font: 11px var(--mono); color: var(--fg-faint); }

@media (max-width: 52rem) {
  .autor, .hash { display: none; }
}
</style>
