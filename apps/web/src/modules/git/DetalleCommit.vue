<script setup lang="ts">
import { ref, watch } from 'vue';
import Loading from '../../ui/Loading.vue';
import { api, q } from '../../api';
import { useGit } from '../../stores/git';

/**
 * Qué tocó un commit.
 *
 * Es la pregunta que uno se hace mirando el árbol: quién hizo qué y dónde. Por
 * eso el autor y la fecha van arriba y los archivos abajo con su recuento de
 * líneas, en vez de tener que abrir un diff para enterarse del alcance.
 */
const props = defineProps<{ hash: string }>();
const emit = defineEmits<{ (e: 'ver', ruta: string): void }>();

const git = useGit();

interface Archivo { ruta: string; origen: string | null; estado: string; mas: number; menos: number; binario: boolean }
interface Detalle {
  hash: string; corto: string; autor: string; correo: string; fecha: number;
  comitero: string; asunto: string; cuerpo: string; esFusion: boolean;
  archivos: Archivo[]; total: { archivos: number; mas: number; menos: number };
}

const detalle = ref<Detalle | null>(null);
const cargando = ref(false);
const error = ref('');

const LETRA: Record<string, string> = {
  modificado: 'M', agregado: 'A', borrado: 'B', renombrado: 'R', copiado: 'C', tipo: 'T',
};

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    detalle.value = await api.get<Detalle>(`/api/git/commit?cwd=${q(git.cwd!)}&hash=${props.hash}`);
  } catch (e: any) {
    error.value = e?.message || 'No se pudo leer el commit';
    detalle.value = null;
  } finally {
    cargando.value = false;
  }
}

watch(() => props.hash, cargar, { immediate: true });

const nombre = (r: string) => r.split('/').pop() ?? r;
const carpeta = (r: string) => { const i = r.lastIndexOf('/'); return i > 0 ? r.slice(0, i) : ''; };
/** Barra proporcional de lo que entró y salió, como la de GitHub. */
function barra(a: Archivo, max: number) {
  const t = Math.max(1, max);
  return { mas: `${(a.mas / t) * 100}%`, menos: `${(a.menos / t) * 100}%` };
}
</script>

<template>
  <div class="detalle">
    <Loading v-if="cargando && !detalle" />
    <p v-else-if="error" class="err">{{ error }}</p>

    <template v-else-if="detalle">
      <header>
        <p class="asunto">{{ detalle.asunto }}</p>
        <p class="quien">
          <strong>{{ detalle.autor }}</strong>
          <span class="correo">{{ detalle.correo }}</span>
        </p>
        <p class="cuando">
          {{ new Date(detalle.fecha).toLocaleString('es') }}
          <code>{{ detalle.corto }}</code>
          <span v-if="detalle.esFusion" class="fusion">merge</span>
        </p>
        <pre v-if="detalle.cuerpo" class="cuerpo">{{ detalle.cuerpo }}</pre>
      </header>

      <p class="resumen">
        {{ detalle.total.archivos }} archivo{{ detalle.total.archivos === 1 ? '' : 's' }}
        <span class="mas">+{{ detalle.total.mas }}</span>
        <span class="menos">−{{ detalle.total.menos }}</span>
      </p>

      <div class="lista">
        <button
          v-for="a in detalle.archivos" :key="a.ruta"
          class="fila" @click="emit('ver', a.ruta)"
        >
          <span class="letra" :class="a.estado">{{ LETRA[a.estado] ?? '?' }}</span>
          <span class="nombre">{{ nombre(a.ruta) }}</span>
          <span class="carpeta">{{ carpeta(a.ruta) }}</span>
          <span v-if="a.binario" class="bin">binario</span>
          <template v-else>
            <span class="cifras"><b class="mas">+{{ a.mas }}</b><b class="menos">−{{ a.menos }}</b></span>
            <span class="barra" aria-hidden="true">
              <i class="v" :style="{ width: barra(a, Math.max(...detalle.archivos.map((x) => x.mas + x.menos))).mas }" />
              <i class="r" :style="{ width: barra(a, Math.max(...detalle.archivos.map((x) => x.mas + x.menos))).menos }" />
            </span>
          </template>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detalle { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }

header { flex: 0 0 auto; padding: 12px 14px 10px; border-bottom: 1px solid var(--border); }
.asunto { margin: 0 0 5px; font-size: 13.5px; font-weight: 600; line-height: 1.4; }
.quien { display: flex; align-items: baseline; gap: 7px; margin: 0; font-size: 12px; }
.quien strong { font-weight: 600; }
.correo { font: 10.5px var(--mono); color: var(--fg-faint); }
.cuando { display: flex; align-items: center; gap: 8px; margin: 3px 0 0; font-size: 11px; color: var(--fg-faint); }
.cuando code { font: 10.5px var(--mono); }
.fusion { padding: 0 6px; border-radius: 20px; background: var(--bg-active); font-size: 10px; }
.cuerpo {
  margin: 8px 0 0; padding: 8px 10px; max-height: 12rem; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px;
  font: 11.5px/1.6 var(--mono); white-space: pre-wrap;
}

.resumen {
  display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
  margin: 0; padding: 7px 14px; font-size: 11.5px; color: var(--fg-faint);
}
.mas { color: var(--ok); }
.menos { color: var(--danger); }

.lista { display: flex; flex-direction: column; }
.fila {
  display: flex; align-items: center; gap: 8px;
  min-height: var(--touch); padding: 0 14px; text-align: left;
}
.fila:hover { background: var(--bg-hover); }
.letra {
  display: grid; place-items: center; flex: 0 0 18px;
  width: 18px; height: 18px; border-radius: 4px;
  border: 1px solid var(--border-strong); font: 600 10px var(--mono); color: var(--fg-dim);
}
.letra.agregado { border-color: var(--ok); color: var(--ok); }
.letra.borrado { border-color: var(--danger); color: var(--danger); }
.letra.renombrado { border-color: var(--accent); color: var(--accent); }
.nombre { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.carpeta {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left; font: 10.5px var(--mono); color: var(--fg-faint);
}
.cifras { display: flex; gap: 6px; flex: 0 0 auto; font: 10.5px var(--mono); }
.barra { display: flex; gap: 1px; flex: 0 0 42px; height: 6px; }
.barra i { display: block; height: 100%; border-radius: 2px; min-width: 0; }
.barra .v { background: var(--ok); }
.barra .r { background: var(--danger); }
.bin { flex: 0 0 auto; font: 10px var(--mono); color: var(--fg-faint); }

.err { margin: 14px; font-size: 12.5px; color: var(--danger); }
</style>
