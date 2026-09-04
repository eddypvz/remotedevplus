<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Icon from '../../ui/Icon.vue';
import Markdown from './Markdown.vue';
import { api, q } from '../../api';
import { useTabs } from '../../stores/tabs';

/**
 * Los documentos de la conversación: planes y archivos que Claude escribió.
 *
 * Nada de esto se guarda aparte. Todo sale del historial, que ya tenemos —en
 * memoria si la conversación está viva, leído del disco si se reanudó—: cada
 * `ExitPlanMode` deja su plan en el `tool_use`, y cada `Write`/`Edit` deja su
 * ruta. Guardar una lista propia se desincronizaría, y además los planes de una
 * conversación vieja aparecen solos al reanudarla.
 *
 * Es solo lectura. Para editar están las pestañas de archivo.
 */
const props = defineProps<{ mensajes: any[]; cwd: string }>();
const emit = defineEmits<{ (e: 'cerrar'): void }>();

const tabs = useTabs();

interface Doc {
  id: string;
  tipo: 'plan' | 'archivo';
  titulo: string;
  /** Los planes traen el contenido puesto; los archivos se leen al abrirlos. */
  contenido?: string;
  path?: string;
}

const ESCRITURA = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const rel = (p: string) => (p.startsWith(props.cwd + '/') ? p.slice(props.cwd.length + 1) : p);
const esTexto = (p: string) => /\.(md|markdown|txt|mdx|rst)$/i.test(p);

const documentos = computed<Doc[]>(() => {
  const planes: Doc[] = [];
  const archivos = new Map<string, Doc>();

  for (const m of props.mensajes) {
    const c = m?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type !== 'tool_use') continue;

      if (b.name === 'ExitPlanMode' && b.input?.plan) {
        const texto = String(b.input.plan);
        // El primer encabezado del markdown es mejor título que "Plan 1".
        const h = texto.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
        planes.push({
          id: `plan:${planes.length}`,
          tipo: 'plan',
          titulo: h || `Plan ${planes.length + 1}`,
          contenido: texto,
        });
      } else if (ESCRITURA.has(b.name)) {
        const path = b.input?.file_path ?? b.input?.notebook_path;
        if (path) archivos.set(path, { id: `f:${path}`, tipo: 'archivo', titulo: rel(path), path });
      }
    }
  }
  // Los planes primero: es lo que más se vuelve a mirar.
  return [...planes.reverse(), ...archivos.values()];
});

const activo = ref<string | null>(null);
const contenido = ref('');
const cargando = ref(false);
const error = ref('');
/** En angosto no caben las dos columnas: se muestra una u otra. */
const enLista = ref(true);

const doc = computed(() => documentos.value.find((d) => d.id === activo.value) ?? null);
const esMarkdown = computed(() => doc.value?.tipo === 'plan' || (doc.value?.path ? esTexto(doc.value.path) : false));

async function abrir(d: Doc) {
  activo.value = d.id;
  enLista.value = false;
  error.value = '';
  if (d.contenido !== undefined) { contenido.value = d.contenido; return; }
  cargando.value = true;
  try {
    const r = await api.get<{ content: string; encoding: string }>(`/api/fs/read?path=${q(d.path!)}`);
    contenido.value = r.encoding === 'binary' ? '' : r.content;
    if (r.encoding === 'binary') error.value = 'Es un archivo binario.';
  } catch (e: any) {
    error.value = e?.message || 'No se pudo leer';
    contenido.value = '';
  } finally {
    cargando.value = false;
  }
}

// Al abrir el modal se muestra el primero, que suele ser el plan más reciente.
watch(documentos, (d) => { if (!activo.value && d.length) abrir(d[0]); }, { immediate: true });
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click.self="emit('cerrar')">
      <div class="hoja" role="dialog" aria-modal="true" aria-label="Documentos de la conversación">
        <header>
          <button v-if="!enLista" class="volver" aria-label="Volver a la lista" @click="enLista = true">
            <Icon name="chevron" :size="15" style="transform: rotate(180deg)" />
          </button>
          <Icon name="file" :size="16" class="marca" />
          <span class="titulo">{{ doc?.titulo ?? 'Documentos' }}</span>
          <button
            v-if="doc?.path" class="acto"
            @click="tabs.open('file', { path: doc.path }); emit('cerrar')"
          >abrir en pestaña</button>
          <button class="x" aria-label="Cerrar" @click="emit('cerrar')">
            <Icon name="close" :size="16" />
          </button>
        </header>

        <div class="cuerpo">
          <nav class="lista rdp-scroll" :class="{ oculta: !enLista }">
            <template v-if="documentos.some((d) => d.tipo === 'plan')">
              <p class="grupo">Planes</p>
              <button
                v-for="d in documentos.filter((x) => x.tipo === 'plan')" :key="d.id"
                class="item" :class="{ on: d.id === activo }" @click="abrir(d)"
              >
                <Icon name="claude" :size="14" />
                <span>{{ d.titulo }}</span>
              </button>
            </template>

            <template v-if="documentos.some((d) => d.tipo === 'archivo')">
              <p class="grupo">Archivos escritos</p>
              <button
                v-for="d in documentos.filter((x) => x.tipo === 'archivo')" :key="d.id"
                class="item" :class="{ on: d.id === activo }" @click="abrir(d)"
              >
                <Icon name="file" :size="14" />
                <span>{{ d.titulo }}</span>
              </button>
            </template>

            <p v-if="!documentos.length" class="nada">
              Todavía no hay planes ni archivos escritos en esta conversación.
            </p>
          </nav>

          <div class="vista rdp-scroll" :class="{ oculta: enLista }">
            <p v-if="error" class="err">{{ error }}</p>
            <p v-else-if="cargando" class="err cargando">leyendo…</p>
            <Markdown v-else-if="esMarkdown && contenido" :source="contenido" />
            <pre v-else-if="contenido" class="plano">{{ contenido }}</pre>
            <p v-else-if="!documentos.length" class="nada">
              Cuando Claude haga un plan o escriba un archivo, aparece acá.
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 66;
  display: grid; place-items: center; padding: 1.5rem;
  padding-top: calc(1.5rem + var(--safe-t)); padding-bottom: calc(1.5rem + var(--safe-b));
  background: var(--scrim);
}
.hoja {
  display: flex; flex-direction: column;
  width: 100%; max-width: 68rem; height: 100%; max-height: 52rem;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 15px; box-shadow: 0 26px 64px var(--shadow); overflow: hidden;
}

header {
  display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
  padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--border);
}
.marca { flex: 0 0 auto; color: var(--accent); }
.titulo { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.volver, .x {
  display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px;
  border-radius: 7px; color: var(--fg-faint);
}
.volver:hover, .x:hover { background: var(--bg-hover); color: var(--fg); }
.acto {
  flex: 0 0 auto; padding: 4px 10px; border-radius: 7px;
  border: 1px solid var(--border-strong); font-size: 11.5px; color: var(--fg-dim);
}
.acto:hover { color: var(--accent); border-color: var(--accent); }

.cuerpo { display: flex; flex: 1; min-height: 0; }

.lista {
  display: flex; flex-direction: column; gap: 1px;
  width: 17rem; flex: 0 0 17rem; min-height: 0; padding: 8px 6px;
  border-right: 1px solid var(--border);
}
.grupo {
  margin: 8px 8px 3px; font-size: 10.5px; font-weight: 600;
  letter-spacing: .06em; text-transform: uppercase; color: var(--fg-faint);
}
.item {
  display: flex; align-items: center; gap: 8px;
  min-height: 34px; padding: 5px 9px; border-radius: 7px; text-align: left;
  color: var(--fg-dim);
}
.item :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); }
.item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.item:hover { background: var(--bg-hover); color: var(--fg); }
.item.on { background: color-mix(in oklab, var(--accent) 10%, transparent); color: var(--fg); font-weight: 550; }
.item.on :deep(svg) { color: var(--accent); }

.vista { flex: 1; min-width: 0; min-height: 0; padding: 22px 26px 30px; background: var(--bg); }
.plano { margin: 0; font: 12.5px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.err { margin: 0; font-size: 12.5px; color: var(--danger); }
.err.cargando { color: var(--fg-faint); }
.nada { margin: 12px 8px; font-size: 12.5px; line-height: 1.6; color: var(--fg-faint); }

/* En angosto no caben las dos columnas: se muestra la lista o la vista. */
@media (max-width: 46rem) {
  .lista { width: auto; flex: 1; border-right: 0; }
  .lista.oculta, .vista.oculta { display: none; }
  .vista { padding: 18px 18px 24px; }
}
@media (min-width: 46.01rem) {
  .volver { display: none; }
}
</style>
