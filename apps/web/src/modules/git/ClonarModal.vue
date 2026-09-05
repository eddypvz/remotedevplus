<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Icon from '../../ui/Icon.vue';
import Loading from '../../ui/Loading.vue';
import FolderBrowser from '../workspace/FolderBrowser.vue';
import { api } from '../../api';
import { useWorkspaces } from '../../stores/workspaces';
import { useTabs } from '../../stores/tabs';
import { useFiles } from '../../stores/files';

/**
 * Clonar un repositorio.
 *
 * Dos caminos a propósito. **Pegar la URL siempre funciona** y no necesita
 * configurar nada. El listado de repositorios necesita un token de GitHub,
 * porque la llave SSH del servidor autentica un `git clone` y nada más: la API
 * no la mira, así que sin token no hay forma de saber qué repositorios existen.
 *
 * El destino se elige navegando las raíces permitidas, y el nombre de la
 * carpeta se escribe: si no existe, el agente la crea al clonar.
 */
const emit = defineEmits<{ (e: 'cerrar'): void }>();

const workspaces = useWorkspaces();
const tabs = useTabs();
const files = useFiles();

interface Repo {
  nombre: string; completo: string; descripcion: string;
  privado: boolean; ssh: string; https: string; rama: string; actualizado: number;
}

const modo = ref<'lista' | 'url'>('url');
const proveedor = ref<{ configurado: boolean; login: string | null }>({ configurado: false, login: null });

const repos = ref<Repo[]>([]);
const cargandoRepos = ref(false);
const filtro = ref('');
const errorRepos = ref('');
const truncado = ref(false);

const url = ref('');
const carpeta = ref<string | null>(null);
const nombre = ref('');
const nombreTocado = ref(false);

const clonando = ref(false);
const salida = ref('');
const error = ref('');

/** El nombre se propone desde la URL, pero deja de proponerse si se escribió. */
function proponerNombre(desde: string) {
  if (nombreTocado.value) return;
  const limpio = desde.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  nombre.value = limpio.split(/[/:]/).filter(Boolean).pop() ?? '';
}

const visibles = computed(() => {
  const t = filtro.value.trim().toLowerCase();
  if (!t) return repos.value;
  return repos.value.filter((r) => (
    r.completo.toLowerCase().includes(t) || r.descripcion.toLowerCase().includes(t)
  ));
});

const destino = computed(() => (carpeta.value && nombre.value ? `${carpeta.value}/${nombre.value}` : ''));
const puedeClonar = computed(() => !!url.value.trim() && !!carpeta.value && !!nombre.value.trim() && !clonando.value);

async function verProveedor() {
  proveedor.value = await api.get<{ configurado: boolean; login: string | null }>('/api/git/provider')
    .catch(() => ({ configurado: false, login: null }));
  if (proveedor.value.configurado) { modo.value = 'lista'; cargarRepos(); }
}

async function cargarRepos() {
  cargandoRepos.value = true;
  errorRepos.value = '';
  try {
    const r = await api.get<{ repos: Repo[]; truncado: boolean }>('/api/git/repos');
    repos.value = r.repos;
    truncado.value = !!r.truncado;
  } catch (e: any) {
    errorRepos.value = e?.message || 'No se pudieron leer los repositorios';
  } finally {
    cargandoRepos.value = false;
  }
}

function elegir(r: Repo) {
  // SSH y no HTTPS: es lo que la llave del servidor usa sin pedir credenciales.
  url.value = r.ssh;
  nombreTocado.value = false;
  proponerNombre(r.nombre);
}

async function clonar() {
  if (!puedeClonar.value) return;
  clonando.value = true;
  error.value = '';
  salida.value = '';
  try {
    const r = await api.post<{ path: string; salida: string }>('/api/git/clone', {
      url: url.value.trim(), dir: carpeta.value, name: nombre.value.trim(),
    });
    salida.value = r.salida;
    // El explorador no se enteraría solo: la carpeta destino puede no estar
    // desplegada, y el canal de eventos solo observa lo que está a la vista.
    if (carpeta.value) await files.refresh(carpeta.value).catch(() => {});
    tabs.open('git', { cwd: r.path, label: nombre.value.trim() });
    emit('cerrar');
  } catch (e: any) {
    error.value = e?.message || 'No se pudo clonar';
  } finally {
    clonando.value = false;
  }
}

const cuando = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 86400000);
  if (d < 1) return 'hoy';
  if (d < 30) return `hace ${d} d`;
  const m = Math.round(d / 30);
  return m < 12 ? `hace ${m} mes${m > 1 ? 'es' : ''}` : `hace ${Math.round(m / 12)} a`;
};

onMounted(verProveedor);
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click.self="emit('cerrar')">
      <div class="hoja" role="dialog" aria-modal="true" aria-label="Clonar un repositorio">
        <header>
          <Icon name="git" :size="16" />
          <h2>Clonar un repositorio</h2>
          <button class="x" aria-label="Cerrar" @click="emit('cerrar')"><Icon name="close" :size="16" /></button>
        </header>

        <nav class="modos">
          <button :class="{ on: modo === 'lista' }" @click="modo = 'lista'">Mis repositorios</button>
          <button :class="{ on: modo === 'url' }" @click="modo = 'url'">Pegar una URL</button>
        </nav>

        <div class="cuerpo">
          <!-- Listado: necesita token -->
          <template v-if="modo === 'lista'">
            <p v-if="!proveedor.configurado" class="aviso">
              <Icon name="alert" :size="14" />
              <span>
                Para listar sus repositorios hace falta un token de GitHub: la llave SSH del
                servidor sirve para clonar, pero la API no la mira. Se configura en
                <b>Ajustes → GitHub</b>. Mientras tanto, «Pegar una URL» funciona sin nada.
              </span>
            </p>

            <template v-else>
              <label class="buscar">
                <Icon name="search" :size="14" />
                <input
                  v-model="filtro" spellcheck="false"
                  :placeholder="repos.length ? `Filtrar entre ${repos.length} repositorios…` : 'Filtrar repositorios…'"
                >
                <button class="recargar" title="Actualizar" @click="cargarRepos">
                  <Icon name="refresh" :size="14" />
                </button>
              </label>

              <p v-if="truncado" class="nada">
                Son demasiados repositorios para traerlos todos; falta parte de la lista.
                Si el que busca no aparece, use «Pegar una URL».
              </p>
              <p v-if="errorRepos" class="err">{{ errorRepos }}</p>
              <Loading v-else-if="cargandoRepos" />
              <p v-else-if="!visibles.length" class="nada">Ningún repositorio coincide.</p>

              <div v-else class="repos rdp-scroll">
                <button
                  v-for="r in visibles" :key="r.completo"
                  class="repo" :class="{ on: url === r.ssh }"
                  @click="elegir(r)"
                >
                  <span class="linea1">
                    <span class="nm">{{ r.completo }}</span>
                    <span v-if="r.privado" class="etiqueta">privado</span>
                    <span class="fecha">{{ cuando(r.actualizado) }}</span>
                  </span>
                  <span v-if="r.descripcion" class="desc">{{ r.descripcion }}</span>
                </button>
              </div>
            </template>
          </template>

          <!-- URL a mano: el camino que siempre funciona -->
          <template v-else>
            <label class="campo">
              <span class="rotulo">Dirección del repositorio</span>
              <input
                :value="url" placeholder="git@github.com:usuario/repo.git"
                spellcheck="false" autocapitalize="off" autocorrect="off"
                @input="(e) => { url = (e.target as HTMLInputElement).value; proponerNombre(url); }"
              >
              <span class="pista">
                Con SSH no pide credenciales: el servidor tiene su propia llave en GitHub.
              </span>
            </label>
          </template>

          <hr class="sep">

          <!-- Destino -->
          <div class="destino">
            <span class="rotulo">¿Dónde se clonará?</span>
            <div class="navegador">
              <FolderBrowser
                :roots="workspaces.roots" :chosen="[]"
                @pick="(p) => { carpeta = p; }"
              />
            </div>
            <p class="elegida">
              <template v-if="carpeta">Carpeta: <code>{{ carpeta }}</code></template>
              <template v-else>Elija la carpeta que contendrá el clon.</template>
            </p>

            <label class="campo">
              <span class="rotulo">Nombre de la carpeta a crear</span>
              <input
                :value="nombre" placeholder="mi-proyecto" spellcheck="false"
                autocapitalize="off" autocorrect="off"
                @input="(e) => { nombre = (e.target as HTMLInputElement).value; nombreTocado = true; }"
              >
              <span class="pista">
                Se crea dentro de la carpeta elegida. Si ya existe y tiene contenido, no se clona.
              </span>
            </label>

            <p v-if="destino" class="resultado">
              Quedará en <code>{{ destino }}</code>
            </p>
          </div>

          <p v-if="error" class="err">{{ error }}</p>
          <pre v-if="salida" class="salida">{{ salida }}</pre>
        </div>

        <footer>
          <button class="no" @click="emit('cerrar')">Cancelar</button>
          <button class="si" :disabled="!puedeClonar" @click="clonar">
            {{ clonando ? 'clonando…' : 'Clonar' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 70;
  display: grid; place-items: center; padding: 1.2rem;
  padding-top: calc(1.2rem + var(--safe-t)); padding-bottom: calc(1.2rem + var(--safe-b));
  background: var(--scrim);
}
.hoja {
  display: flex; flex-direction: column;
  width: 100%; max-width: 44rem; max-height: min(88vh, 88dvh);
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: 0 24px 60px var(--shadow); overflow: hidden;
}

header {
  display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
  padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--border);
}
header :deep(svg) { flex: 0 0 auto; color: var(--accent); }
h2 { flex: 1; margin: 0; font-size: 14.5px; font-weight: 650; }
.x { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--fg-faint); }
.x:hover { background: var(--bg-hover); color: var(--fg); }

.modos { display: flex; gap: 14px; flex: 0 0 auto; padding: 9px 16px 0; }
.modos button {
  padding: 0 0 8px; border-bottom: 2px solid transparent;
  font-size: 12.5px; color: var(--fg-faint);
}
.modos button.on { color: var(--fg); font-weight: 600; border-bottom-color: var(--accent); }

/* El scroll vive en el cuerpo: así la cabecera y el pie quedan fijos y en
   tablet no se pierde el botón de clonar al bajar. */
.cuerpo { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; }

.aviso {
  display: flex; align-items: flex-start; gap: 8px; margin: 4px 0 0;
  padding: 10px 12px; border-radius: 9px;
  background: color-mix(in oklab, var(--warn) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
  font-size: 12.5px; line-height: 1.6; color: var(--fg-dim);
}
.aviso :deep(svg) { flex: 0 0 auto; margin-top: 3px; color: var(--warn); }

.buscar {
  display: flex; align-items: center; gap: 7px; margin: 6px 0 8px;
  padding: 0 4px 0 10px; height: 34px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 9px;
}
.buscar :deep(svg) { flex: 0 0 auto; color: var(--fg-faint); }
.buscar input { flex: 1; min-width: 0; border: 0; background: none; font-size: 12.5px; }
.buscar input:focus { outline: none; }
.recargar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; color: var(--fg-faint); }
.recargar:hover { background: var(--bg-hover); color: var(--fg); }

.repos { display: flex; flex-direction: column; gap: 2px; max-height: 15rem; }
.repo {
  display: flex; flex-direction: column; gap: 2px;
  padding: 7px 10px; border-radius: 8px; text-align: left;
  border: 1px solid transparent;
}
.repo:hover { background: var(--bg-hover); }
.repo.on { background: var(--bg-active); border-color: var(--accent); }
.linea1 { display: flex; align-items: center; gap: 7px; }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.etiqueta {
  flex: 0 0 auto; padding: 0 6px; border-radius: 20px;
  background: var(--bg-surface); font: 10px var(--mono); color: var(--fg-faint);
}
.fecha { flex: 0 0 auto; font: 10.5px var(--mono); color: var(--fg-faint); }
.desc {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11.5px; color: var(--fg-faint);
}

.sep { margin: 14px 0; border: 0; border-top: 1px solid var(--border); }

.campo { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 0; }
.rotulo { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--fg-faint); }
.campo input {
  height: 36px; padding: 0 11px;
  background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: 9px; font: 12.5px var(--mono); color: var(--fg);
}
.campo input:focus { outline: none; border-color: var(--accent); }
.pista { font-size: 11.5px; line-height: 1.5; color: var(--fg-faint); }

.destino { display: flex; flex-direction: column; gap: 6px; }
.navegador {
  display: flex; max-height: 15rem; min-height: 10rem;
  background: var(--bg); border: 1px solid var(--border); border-radius: 9px; overflow: hidden;
}
/*
 * El navegador se estira a todo el ancho.
 *
 * `.browser` es una columna flex sin ancho propio, así que como hijo flex tomaba
 * el de su contenido y dejaba la mitad del modal en blanco. Se le quitan el
 * borde y el radio porque el contenedor ya los tiene: dos bordes juntos se ven
 * como un error.
 */
.navegador :deep(.browser) {
  flex: 1; min-width: 0;
  border: 0; border-radius: 0; background: none;
}
/* Las filas ocupan la línea entera, así el área que se puede tocar es toda la
   fila y no solo el texto — en tablet eso se nota. */
.navegador :deep(.nm) { flex: 1; min-width: 0; }
.elegida { margin: 0; font-size: 12px; color: var(--fg-dim); }
.elegida code, .resultado code { font: 11.5px var(--mono); overflow-wrap: anywhere; }
.resultado {
  margin: 6px 0 0; padding: 8px 11px; border-radius: 8px;
  background: var(--bg-surface); font-size: 12px; color: var(--fg-dim);
}

.err { margin: 10px 0 0; font-size: 12px; color: var(--danger); line-height: 1.55; }
.nada { margin: 10px 0; font-size: 12px; color: var(--fg-faint); }
.salida {
  margin: 10px 0 0; padding: 9px 11px; max-height: 9rem; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  font: 11px/1.5 var(--mono); color: var(--fg-faint); white-space: pre-wrap;
}

footer {
  display: flex; justify-content: flex-end; gap: 8px; flex: 0 0 auto;
  padding: 11px 16px calc(11px + var(--safe-b));
  border-top: 1px solid var(--border); background: var(--bg-panel);
}
footer button { height: 36px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 550; }
.no { background: var(--bg-surface); border: 1px solid var(--border-strong); color: var(--fg-dim); }
.no:hover { color: var(--fg); }
.si { background: var(--accent); color: var(--on-accent); }
.si:disabled { opacity: .45; cursor: default; }
</style>
