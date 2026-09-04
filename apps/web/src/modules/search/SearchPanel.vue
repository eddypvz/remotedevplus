<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import Icon from '../../ui/Icon.vue';
import { useWorkspaces } from '../../stores/workspaces';
import { useTabs } from '../../stores/tabs';
import { useSession } from '../../stores/session';
import { useDialogo } from '../../stores/dialogo';
import { api } from '../../api';

/**
 * Buscador global.
 *
 * Los resultados llegan en streaming y se pintan a medida que caen: en un
 * repositorio grande la primera coincidencia aparece enseguida y esperar el
 * total para mostrar algo sería tiempo regalado.
 *
 * Se busca al enviar y no mientras se escribe. Con teclado sería debatible;
 * en tablet, disparar una búsqueda por tecla castiga el disco sin que nadie lo
 * haya pedido.
 */
const workspaces = useWorkspaces();
const tabs = useTabs();
const session = useSession();
const dialogo = useDialogo();

interface Coincidencia { ruta: string; linea: number; texto: string; partes: { desde: number; hasta: number }[] }
interface Grupo { ruta: string; coincidencias: Coincidencia[] }

const patron = ref('');
const incluir = ref('');
const opciones = ref(false);
const literal = ref(true);
const sensible = ref(false);
const palabraCompleta = ref(false);

/*
 * El reemplazo lo hace ripgrep en el agente, con el MISMO patrón y las mismas
 * banderas con las que buscó. No se manda una lista de posiciones: entre que se
 * pintó el resultado y se toca el botón, el archivo puede haber cambiado, y
 * escribir en un desplazamiento viejo corrompe en silencio.
 */
const reemplazo = ref('');
const mostrarReemplazo = ref(false);
const reemplazando = ref(false);
const puedeReemplazar = computed(() => session.can('fs:write'));

const grupos = ref<Grupo[]>([]);
const total = ref(0);
const buscando = ref(false);
const fin = ref<{ cortado?: boolean; motivo?: string; errores?: string } | null>(null);
const plegados = ref(new Set<string>());

let abort: AbortController | null = null;

const carpetas = computed(() => (workspaces.active?.folders ?? []).map((f) => f.path));
const rel = (p: string) => {
  const f = (workspaces.active?.folders ?? []).find((x) => p.startsWith(x.path + '/'));
  return f ? `${f.name}/${p.slice(f.path.length + 1)}` : p;
};

/** Parte la línea en los tramos que coinciden y los que no, para resaltar. */
function tramos(c: Coincidencia) {
  if (!c.partes.length) return [{ texto: c.texto, marca: false }];
  const out: { texto: string; marca: boolean }[] = [];
  let i = 0;
  for (const p of c.partes) {
    if (p.desde > i) out.push({ texto: c.texto.slice(i, p.desde), marca: false });
    out.push({ texto: c.texto.slice(p.desde, p.hasta), marca: true });
    i = p.hasta;
  }
  if (i < c.texto.length) out.push({ texto: c.texto.slice(i), marca: false });
  return out;
}

function cancelar() {
  abort?.abort();
  abort = null;
  buscando.value = false;
}

async function buscar() {
  const q = patron.value.trim();
  if (!q || !carpetas.value.length) return;
  cancelar();

  grupos.value = [];
  total.value = 0;
  fin.value = null;
  buscando.value = true;

  abort = new AbortController();
  const porRuta = new Map<string, Grupo>();

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        cwds: carpetas.value,
        patron: q,
        literal: literal.value,
        sensible: sensible.value,
        palabraCompleta: palabraCompleta.value,
        incluir: incluir.value,
      }),
    });
    if (!res.body) throw new Error('El servidor no devolvió resultados');

    const lector = res.body.getReader();
    const dec = new TextDecoder();
    let resto = '';

    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      resto += dec.decode(value, { stream: true });
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';

      for (const l of lineas) {
        if (!l) continue;
        const e = JSON.parse(l);
        if (e.t === 'coincidencia') {
          let g = porRuta.get(e.ruta);
          if (!g) {
            g = { ruta: e.ruta, coincidencias: [] };
            porRuta.set(e.ruta, g);
            grupos.value = [...grupos.value, g];
          }
          g.coincidencias.push(e);
          total.value++;
        } else if (e.t === 'fin' || e.t === 'error') {
          fin.value = e.t === 'error' ? { errores: e.mensaje } : e;
        }
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') fin.value = { errores: e?.message || 'Falló la búsqueda' };
  } finally {
    buscando.value = false;
    abort = null;
  }
}

function abrir(c: Coincidencia) {
  tabs.open('file', { path: c.ruta, linea: c.linea });
}

/** El cuerpo que describe esta búsqueda; el reemplazo la repite tal cual. */
const consulta = () => ({
  cwds: carpetas.value,
  patron: patron.value.trim(),
  literal: literal.value,
  sensible: sensible.value,
  palabraCompleta: palabraCompleta.value,
  incluir: incluir.value,
});

/**
 * Reemplaza en todo lo encontrado, o en un solo archivo.
 *
 * Siempre pregunta: no hay deshacer, y una expresión regular mal escrita puede
 * tocar cientos de archivos. El diálogo dice cuántos, que es el dato que hace
 * dudar a tiempo.
 */
async function reemplazarTodo(soloRuta?: string) {
  if (!patron.value.trim() || !grupos.value.length) return;
  const objetivo = soloRuta ? grupos.value.filter((g) => g.ruta === soloRuta) : grupos.value;
  const nArchivos = objetivo.length;
  const nCoincidencias = objetivo.reduce((n, g) => n + g.coincidencias.length, 0);

  const ok = await dialogo.confirmar({
    titulo: 'Reemplazar en el disco',
    mensaje: `Se cambiarán ${nCoincidencias} coincidencia${nCoincidencias === 1 ? '' : 's'} `
      + `en ${nArchivos} archivo${nArchivos === 1 ? '' : 's'}. No hay deshacer: `
      + 'conviene tener el trabajo en git antes.',
    detalle: `${patron.value}\n  →  ${reemplazo.value || '(vacío: se borra lo encontrado)'}`,
    aceptar: 'Reemplazar',
    peligroso: true,
  });
  if (!ok) return;

  reemplazando.value = true;
  try {
    const r = await api.post<{ archivos: number; sustituciones: number; fallos: { ruta: string; motivo: string }[] }>(
      '/api/search/replace',
      { ...consulta(), replacement: reemplazo.value, paths: soloRuta ? [soloRuta] : undefined },
    );
    fin.value = {
      errores: r.fallos.length
        ? `${r.fallos.length} archivo(s) no se pudieron reescribir: ${r.fallos[0].motivo}`
        : undefined,
    };
    // Se vuelve a buscar: lo que queda en pantalla ya no existe en el disco.
    await buscar();
    if (!r.fallos.length) {
      fin.value = { motivo: `Se reemplazaron ${r.sustituciones} en ${r.archivos} archivo(s)` };
    }
  } catch (e: any) {
    fin.value = { errores: e?.message || 'No se pudo reemplazar' };
  } finally {
    reemplazando.value = false;
  }
}

function plegar(ruta: string) {
  const s = new Set(plegados.value);
  s.has(ruta) ? s.delete(ruta) : s.add(ruta);
  plegados.value = s;
}

onBeforeUnmount(cancelar);
</script>

<template>
  <div class="buscador">
    <form class="campo" @submit.prevent="buscar">
      <label class="caja">
        <Icon name="search" :size="14" />
        <input
          v-model="patron" placeholder="Buscar en el workspace…"
          spellcheck="false" autocapitalize="off" autocorrect="off"
        >
        <button
          v-if="buscando" type="button" class="parar" title="Cancelar" @click="cancelar"
        ><Icon name="close" :size="13" /></button>
      </label>
      <button
        v-if="puedeReemplazar" type="button" class="mas" :class="{ on: mostrarReemplazo }"
        title="Reemplazar" @click="mostrarReemplazo = !mostrarReemplazo"
      >⇄</button>
      <button type="button" class="mas" :class="{ on: opciones }" title="Opciones" @click="opciones = !opciones">
        <Icon name="settings" :size="14" />
      </button>
    </form>

    <div v-if="mostrarReemplazo && puedeReemplazar" class="campo reemplazo">
      <label class="caja">
        <span class="flecha">→</span>
        <input
          v-model="reemplazo"
          :placeholder="literal ? 'Reemplazar por…' : 'Reemplazar por…  ${1} para los grupos'"
          spellcheck="false" autocapitalize="off" autocorrect="off"
          @keydown.enter.prevent="reemplazarTodo()"
        >
      </label>
      <button
        type="button" class="hacer" :disabled="!grupos.length || reemplazando || buscando"
        :title="grupos.length ? `Reemplazar en ${grupos.length} archivo(s)` : 'Primero hay que buscar'"
        @click="reemplazarTodo()"
      >{{ reemplazando ? '…' : 'todo' }}</button>
    </div>

    <div v-if="opciones" class="opciones">
      <input v-model="incluir" class="glob" placeholder="*.php, src/**  (dejar vacío = todo)" spellcheck="false">
      <div class="interruptores">
        <label><input v-model="literal" type="checkbox"> texto literal</label>
        <label><input v-model="sensible" type="checkbox"> distinguir mayúsculas</label>
        <label><input v-model="palabraCompleta" type="checkbox"> palabra completa</label>
      </div>
    </div>

    <p v-if="!carpetas.length" class="aviso">Abra un workspace para poder buscar.</p>
    <p v-else-if="buscando || total" class="resumen">
      {{ total }} en {{ grupos.length }} archivo{{ grupos.length === 1 ? '' : 's' }}
      <span v-if="buscando" class="latido">buscando…</span>
      <span v-else-if="fin?.cortado" class="corte">se cortó en el límite</span>
    </p>
    <p v-else-if="fin && !fin.errores" class="aviso">Sin coincidencias.</p>
    <p v-if="fin?.errores" class="err">{{ fin.errores }}</p>

    <div class="resultados rdp-scroll">
      <div v-for="g in grupos" :key="g.ruta" class="grupo">
        <div class="cabecera">
          <button class="archivo" @click="plegar(g.ruta)">
            <Icon name="chevron" :size="12" :style="{ transform: plegados.has(g.ruta) ? 'none' : 'rotate(90deg)' }" />
            <span class="ruta">{{ rel(g.ruta) }}</span>
            <span class="n">{{ g.coincidencias.length }}</span>
          </button>
          <button
            v-if="mostrarReemplazo && puedeReemplazar" class="soloEste"
            :disabled="reemplazando" title="Reemplazar solo en este archivo"
            @click.stop="reemplazarTodo(g.ruta)"
          >⇄</button>
        </div>
        <template v-if="!plegados.has(g.ruta)">
          <button v-for="c in g.coincidencias" :key="c.linea + ':' + c.texto" class="linea" @click="abrir(c)">
            <span class="num">{{ c.linea }}</span>
            <span class="texto"><span
              v-for="(t, i) in tramos(c)" :key="i" :class="{ marca: t.marca }"
            >{{ t.texto }}</span></span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.buscador { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.campo { display: flex; gap: 5px; flex: 0 0 auto; padding: 8px 8px 6px; }
.caja {
  display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
  height: 32px; padding: 0 8px 0 10px;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 8px;
}
.caja:focus-within { border-color: var(--accent); }
.caja :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); }
.caja input { flex: 1; min-width: 0; border: 0; background: none; font-size: 12.5px; }
.caja input:focus { outline: none; }
.parar { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 5px; color: var(--fg-faint); }
.parar:hover { color: var(--danger); }
.mas {
  display: grid; place-items: center; width: 32px; flex: 0 0 32px;
  border: 1px solid var(--border-strong); border-radius: 8px; color: var(--fg-faint);
}
.mas:hover, .mas.on { color: var(--accent); border-color: var(--accent); }

.opciones { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; padding: 0 8px 8px; }
.glob {
  height: 28px; padding: 0 9px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px;
  font: 11.5px var(--mono);
}
.glob:focus { outline: none; border-color: var(--accent); }
.interruptores { display: flex; flex-wrap: wrap; gap: 10px; }
.interruptores label { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--fg-dim); cursor: pointer; }
.interruptores input { width: 13px; height: 13px; accent-color: var(--accent); }

.resumen, .aviso, .err {
  margin: 0; padding: 4px 12px 8px; font-size: 11.5px; color: var(--fg-faint);
}
.err { color: var(--danger); }
.latido { color: var(--accent); }
.corte { color: var(--warn); }

.resultados { flex: 1; min-height: 0; padding-bottom: 14px; }

.campo.reemplazo { padding-top: 0; }
.reemplazo .flecha { flex: 0 0 auto; font-size: 13px; color: var(--fg-faint); }
.hacer {
  flex: 0 0 auto; min-width: 46px; height: 30px; padding: 0 10px;
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: 8px; font-size: 12px; color: var(--fg-dim);
}
.hacer:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
.hacer:disabled { opacity: .4; cursor: default; }

.cabecera { display: flex; align-items: center; }
.soloEste {
  flex: 0 0 auto; width: 28px; height: 26px; margin-right: 4px;
  border-radius: 6px; color: var(--fg-faint); font-size: 13px;
}
.soloEste:hover:not(:disabled) { background: var(--bg-active); color: var(--danger); }
.soloEste:disabled { opacity: .4; }

.grupo { display: flex; flex-direction: column; }
.cabecera .archivo { flex: 1; min-width: 0; }
.archivo {
  display: flex; align-items: center; gap: 6px;
  position: sticky; top: 0; z-index: 1;
  min-height: 30px; padding: 0 10px; text-align: left;
  background: var(--bg-panel);
}
.archivo:hover { background: var(--bg-hover); }
.archivo :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); transition: transform .12s; }
.ruta {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left; font: 11.5px var(--mono); color: var(--fg-dim);
}
.n { flex: 0 0 auto; padding: 0 6px; border-radius: 20px; background: var(--bg-active); font: 10px var(--mono); color: var(--fg-faint); }

.linea {
  display: flex; align-items: baseline; gap: 8px;
  min-height: 26px; padding: 3px 10px 3px 26px; text-align: left; width: 100%;
}
.linea:hover { background: var(--bg-hover); }
.num { flex: 0 0 auto; min-width: 2.2rem; text-align: right; font: 10.5px var(--mono); color: var(--fg-faint); }
.texto {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 11.5px var(--mono); color: var(--fg-dim);
}
.marca { background: color-mix(in oklab, var(--warn) 40%, transparent); color: var(--fg); border-radius: 2px; }
</style>
