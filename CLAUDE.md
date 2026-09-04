# remotedevplus — contexto para una sesión de IA

Un IDE web para desarrollo remoto, **optimizado para tablet**. Nace de dos
problemas de code-server: no está pensado para iPad, y su panel de git es
inservible.

**Antes de tocar nada, cuatro cosas que no son negociables:**

1. **Todo el texto va en español formal, sin voseo.** "¿En qué carpeta desea
   abrir…?", nunca "¿En qué carpeta abrís…?". Aplica a la UI, los mensajes de
   error del agente, la salida del CLI, **los comentarios del código** y los
   documentos. Regla completa en `docs/ARCHITECTURE.md` § *Idioma de la interfaz*.
2. **Los términos técnicos van en inglés, la prosa en español.** `fetch`,
   `pull`, `push`, `rebase`, `checkout`, `branch`, `stage`, `staged`,
   `untracked`, `stash`, `HEAD`, `commit`. Traducirlos confunde a quien ya sabe
   git, y no ayuda a quien no. Nada de verbos inventados: "Hacer commit", no
   "commitear". La regla vale para el texto visible; los identificadores y
   comentarios del código siguen en español.
3. **`npm run check` antes de dar algo por hecho.** El typecheck solo no
   alcanza: `vue-tsc` no detecta etiquetas HTML mal cerradas en las plantillas.
   `check` corre typecheck + build + tests.

4. **Nunca hacer `git commit` ni `git push`.** El historial lo controla Eddy,
   siempre a mano. Lo que sí corresponde es **redactar el mensaje y anotarlo en
   la bitácora del final de este archivo**, para que quede la ruta de lo hecho
   aunque el commit lo dé él después. Vale también para `git tag`, `git reset`
   y cualquier cosa que reescriba historial.

## Cómo se corre

```bash
npm install && npm run build
node apps/agent/src/cli.js user add <nombre> --admin   # solo la primera vez
node apps/agent/src/cli.js serve                        # lee remotedevplus.config.json
```

| Comando | Qué hace |
|---|---|
| `npm run check` | typecheck + build + tests. **Correr esto siempre** |
| `npm test` | solo los tests (`node:test`, sin dependencias) |
| `npm run dev` | agente + Vite con recarga en caliente |
| `npm run sdk:check` | qué cambió en el Claude Agent SDK desde la última foto |
| `npm run user -- …` | `list`, `add`, `passwd`, `perms`, `roots`, `disable`, `rm` |

**El agente sirve el SPA él mismo**: no hay Apache, nginx ni vhost. Después de
tocar `apps/web/` hay que `npm run build` o el navegador sigue viendo lo viejo.

## Mapa del repositorio

```
apps/agent/          Node + Fastify, sin privilegios, sirve la API y el SPA
  src/cli.js           serve | user …
  src/config.js        flags + remotedevplus.config.json (gitignored)
  src/paths.js         LA FRONTERA DE SEGURIDAD. Todo pasa por acá
  src/db/index.js      node:sqlite, migraciones por índice
  src/hosts/           interfaz Host; solo LocalHost por ahora
  src/services/        auth, users, workspaces, pty, claude, audit
  src/routes/          REST y WebSocket; cada ruta declara su `requires`
apps/web/            Vue 3 + Vite → dist/, que sirve el agente
  src/layout/          rail, sidebar, workbench con pestañas
  src/modules/         cada módulo es una pestaña o un panel
  src/stores/          Pinia
packages/protocol/   tipos y constantes compartidas, JS plano sin build
tests/               node:test
scripts/             dev.mjs, sdk-surface.mjs
docs/                ARCHITECTURE.md, SDK.md, sdk-surface.json
```

## Estado por módulo

| Módulo | Estado | Dónde |
|---|---|---|
| Layout, rail, pestañas | ✅ | `layout/`, `stores/layout.ts`, `stores/tabs.ts` |
| Auth, permisos, usuarios | ✅ | `services/auth.js`, `services/users.js`, `modules/users/` |
| Workspaces | ✅ | `services/workspaces.js`, `modules/workspace/` |
| Explorador de archivos | ✅ | `modules/explorer/` |
| Terminal | ✅ | `modules/terminal/` |
| **Claude nativo** | ✅ **cerrado** | `modules/claude-native/`, `services/claude.js` |
| Claude en terminal | ✅ | `modules/claude/` — un PTY pelado, a propósito |
| Visor de archivos | ✅ CodeMirror 6, resaltado, plegado, búsqueda | `modules/file/` |
| Buscador | ✅ ripgrep en streaming | `services/search.js`, `modules/search/` |
| Git | ✅ árbol, tres cubetas, stash, diff, detalle de commit, traer/bajar/subir/rebase/checkout | `services/git.js`, `modules/git/` |
| Base de datos | ⬜ placeholder | `modules/db/` |

## El módulo de Claude — cerrado

Hay **dos clientes** y conviven a propósito. Se elige al abrir, en el diálogo de
carpeta.

| | `claude-native` | `claude` (terminal) |
|---|---|---|
| Qué corre | `@anthropic-ai/claude-agent-sdk` | el binario `claude` en un PTY |
| Historial | leído del disco, reanudable | dentro de la TUI, irrecuperable |
| Permisos y preguntas | diálogos propios | dentro de la TUI |
| Modelo y modo | en caliente | al lanzar |
| Novedades de Claude Code | hay que implementarlas | aparecen solas |

El nativo existe porque **la TUI dibuja sobre un buffer de pantalla y no entrega
los mensajes**. Se intentó rodearla de controles (compositor, selector de
modelo, cabecera) y no alcanzó; ese intento se revirtió y el terminal volvió a
ser un terminal. Si a alguien se le ocurre reintentarlo, ya está probado que no
funciona.

### Qué hay dentro del nativo

- **Historial**: `listSessions` / `getSessionMessages`. Panel en el sidebar con
  buscador, renombrar y eliminar. Las abiertas se separan de las guardadas.
- **Streaming**: `includePartialMessages`. Los fragmentos se emiten en vivo y
  **no** entran al buffer — son cientos por respuesta y el mensaje completo
  llega detrás.
- **Permisos**: `canUseTool`, con las tres opciones que da el SDK (denegar,
  permitir una vez, permitir siempre vía `suggestions`).
- **Preguntas** (`AskUserQuestion`): pestaña por pregunta, radios o casillas,
  campo libre. Se contestan por `updatedInput.answers`.
- **Planes** (`ExitPlanMode`): modal de lectura con el markdown.
- **Documentos**: modal de dos paneles con planes y archivos escritos, derivados
  del historial.
- **Tareas en segundo plano**: `task_started` / `task_progress` /
  `task_notification`, reenviadas al reconectar.
- **Medidor**: tokens y costo de `result.modelUsage`.

### Cuando el SDK se actualice

```bash
npm update @anthropic-ai/claude-agent-sdk
npm run sdk:check     # verde: apareció. rojo: se fue. error: se fue algo que usamos
npm run sdk:snapshot  # aceptar
npm run check
```

`docs/SDK.md` tiene el inventario completo: usamos 9 de 66 opciones, con el
resto ordenado por lo que aportaría, y **lo aprendido a los golpes que no está
en la documentación oficial**. Leerlo antes de tocar `services/claude.js`.

## Decisiones que conviene no revertir sin leer el porqué

Todas están razonadas en `docs/ARCHITECTURE.md`. Las que más cuesta reconstruir:

- **El agente se sirve a sí mismo y corre sin privilegios.** Nada de gestionar
  Apache ni MySQL: eso pide root, rompe la replicabilidad y multiplica la
  superficie. El aislamiento entre devs sale de *un agente por dev*
  (`deploy/remotedevplus@.service`), no de código.
- **`paths.js` es la única frontera.** Toda ruta se resuelve con `realpath` y se
  valida contra las raíces del usuario. Un workspace **recorta** el acceso,
  nunca lo otorga.
- **La autorización va en el agente, no en la UI.** Cada ruta declara
  `config: { requires }` y un solo hook lo aplica. Esconder un icono no protege
  nada.
- **El sidebar lo controla el usuario, y el colapso automático se declara por
  módulo.** Aplicarlo a todos los que van a pantalla completa se probó y
  estorbaba: el explorador se quiere abierto mientras se usa Claude Code. Solo
  git lo pide (`ocultaBarra`), porque ya elige su carpeta al abrirse.
- **SQLite es `node:sqlite`** y el hash es `scrypt` de `node:crypto`: cero
  dependencias nativas. La única nativa es `node-pty`, y se usa la variante con
  binarios precompilados.

## Trampas que ya nos costaron tiempo

- **`vue-tsc` no ve etiquetas HTML mal cerradas.** Correr el build.
- **Un ancestro con `overflow` recorta los menús** posicionados en absoluto.
  Pasó dos veces. Antes de agregar un menú o diálogo, revisar qué le queda arriba.
- **`backdrop-filter` sobre un canvas WebGL rompe el hit-testing en WebKit**: el
  modal se ve pero no recibe clics. Por eso ningún scrim lo usa.
- **El portapapeles del navegador no existe fuera de HTTPS.**
  `navigator.clipboard` está *undefined* servido por HTTP, así que hay un
  respaldo con `execCommand('copy')` en `ui/portapapeles.ts`. Copiar siempre por
  ahí, nunca directo.
- **`vh` no sirve en iPad**: mide el viewport grande. Siempre `dvh`.
- **`flex: 0 0 auto` no scrollea, empuja.** Un panel que debe ceder necesita
  `flex: 0 1 auto` **y** un `min-height` propio, o se aplasta a una rendija.
- **El CLI de Claude no arranca hasta el primer mensaje**, así que el `system/init`
  no existe antes de eso.
- **Un comando que anda en la terminal puede no existir para `spawn`.** `rg`
  acá es una *función de shell* que enruta al binario de Claude Code, no un
  ejecutable: `command -v rg` responde, pero `spawn('rg')` da ENOENT. Por eso
  ripgrep viene empaquetado con el proyecto.
- **Git contra la red se cuelga sin `GIT_TERMINAL_PROMPT=0`.** Sin eso git se
  queda esperando credenciales que nadie va a escribir, y la petición no
  termina nunca. Va junto con `ssh -o BatchMode=yes` y un tope de tiempo.
- **No hay `confirm()` ni `alert()` nativos.** Se usa `useDialogo()`, que
  devuelve una promesa y respeta el tema. Los del navegador ignoran los
  colores, no se pueden redactar y bloquean el hilo.
- **npm 11 bloquea los install scripts.** Quedan aprobados en `allowScripts` del
  `package.json` raíz, que se commitea.

## Pendientes conocidos

En `docs/ARCHITECTURE.md` § *Deuda conocida*, y arriba en la tabla de módulos.
Los dos que más se notan:

- **`/ws/events` está definido en el protocolo pero sin implementar**: el
  explorador no se entera cuando cambian archivos en disco.
- **Las conversaciones de todos los devs van al mismo `~/.claude/projects`** con
  un agente compartido. La separación que hace `claude_sessions` es lógica, no
  del sistema de archivos.


## Bitácora de commits

Los commits los da Eddy a mano. Cada tanda de trabajo deja aquí su mensaje
redactado, en orden cronológico inverso, para que la próxima sesión sepa qué
entró y cuándo — sin depender de que el commit ya se haya dado.

Formato: encabezado en una línea (imperativo, ≤72 caracteres), línea en blanco,
y el cuerpo explicando el *porqué* antes que el *qué*.

### Pendiente de commit — el inicial

Cubre todo el proyecto: el repositorio se borró y se volvió a clonar para
dejar un solo commit en lugar de los 24 que se habían acumulado. El rename a
`remotedevplus` entró en la misma tanda.

```
remotedevplus: IDE web para desarrollo remoto, optimizado para tablet

Nace de dos problemas concretos de code-server: no está pensado para iPad, y su
panel de git es inservible.

El agente se sirve a sí mismo. No necesita Apache, nginx ni un vhost: un comando
y la aplicación está arriba. Corre sin privilegios a propósito — gestionar el
servidor web o la base de datos pediría root, rompería la replicabilidad y
multiplicaría la superficie de ataque. El aislamiento entre devs sale de correr
un agente por dev, no de código.

AGENTE (Node + Fastify)

- PTY real con node-pty, que es lo que hace que la TUI de Claude Code funcione
  igual que en una terminal nativa: sus menús, Shift+Tab y Esc.
- Ring buffer por sesión indexado por offset absoluto en bytes. Ese offset es el
  seq del protocolo, así que al reconectar se reproduce solo el delta y el
  scrollback queda continuo: el iPad puede suspender la pestaña sin matar nada.
- Frontera de rutas con realpath contra las raíces del usuario. Es la única
  barrera real del sistema y todo pasa por ahí.
- Auth con sesiones server-side en SQLite (node:sqlite, integrado en Node 24) y
  scrypt de node:crypto, para no depender de otro módulo nativo.
- Autorización aplicada en el agente y no en la UI: cada ruta declara su
  `requires` y un solo hook lo verifica.
- Raíces por usuario como rutas propias, con dos guardarraíles de escalada: no
  se pueden otorgar raíces fuera de las propias ni permisos que uno no tiene.
- Workspaces: conjuntos de carpetas por usuario. Recortan el acceso, nunca lo
  otorgan; se validan al guardar y otra vez al leer.
- Git en formato de máquina, nunca parseando salida para humanos. El reparto de
  carriles del árbol se calcula acá: es O(n) y evita recorrer el grafo en cada
  pintado del navegador.
- Búsqueda con ripgrep en streaming, con el binario empaquetado.
- Interfaz Host con LocalHost como única implementación, como costura para el
  multi-host por SSH.

WEB (Vue 3 + Vite)

- Rail con dos comportamientos de icono: panel y lanzador. Cambiar de pestaña
  desde el rail solo pasa cuando la barra no se puede mostrar de otro modo.
- Pestañas que no se desmontan, para no destruir el estado de los terminales.
- Temas claro y oscuro; el claro sigue VS Code Light Modern.
- Editor con CodeMirror 6 y no Monaco: Monaco es justamente por qué code-server
  se siente mal en iPad — pesa unos 5MB, no tiene selección táctil real y pelea
  con el teclado virtual.
- Gestor de git a pantalla completa: árbol de commits, las tres cubetas de
  trabajo siempre visibles con sus botones puestos —no al pasar el mouse, que en
  tablet no existe—, stash con el detalle de qué toca cada entrada, y las
  operaciones de remoto.
- Claude Code en dos sabores que conviven: la TUI en un PTY, y un cliente nativo
  sobre el Agent SDK con historial leído del disco, permisos y preguntas como
  diálogos, streaming token a token y medidor de tokens.
- Optimización para tablet: barra de teclas accesorias con Esc y Shift+Tab, sin
  las cuales Claude Code no se maneja en iPad.

Tests con node:test, sin dependencias: la frontera de rutas, las escaladas de
privilegio, el ring buffer, los carriles del árbol, el saneado del markdown y la
paridad de tiempos del login.

Interfaz en español formal; los términos técnicos de git en inglés.
```
