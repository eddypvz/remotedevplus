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

### Como servicio, que es como se usa de verdad

```bash
sudo deploy/instalar.sh --host 0.0.0.0        # idempotente; --help lista todo
journalctl -u remotedevplus@<usuario> -f
```

Es lo único del proyecto que pide root, y hace dos cosas que el agente no puede
hacer solo: escribir en `/etc` y registrar la unidad de systemd. El agente
sigue corriendo sin privilegios. Compila el SPA si falta `dist/`, que en un
clon nuevo siempre falta porque está en `.gitignore`.

En **esta** máquina encuentra solo el certificado del devserver, que ya cubre
sus nombres —incluido el de Tailscale—, así que no hay que generar nada ni
reinstalar la CA en los dispositivos. En otra hay que pasar `--cert` y `--key`.
**Hay que volver a correr el script si se regenera el certificado**, porque lo
que lee el agente es una copia.

**`sudo` desde el terminal del IDE** no funciona por defecto: la unidad lleva
`NoNewPrivileges`, que anula el bit setuid, y `ProtectSystem=full`, que deja
`/etc` en solo lectura. Se habilita con `--permitir-sudo`, que quita las dos —un
`sudo` que arranca y después falla al escribir es peor que no tenerlo— y deja el
terminal igual que una sesión SSH. Con un solo dueño no agrega nada que no
tuviera; con varios devs, le da root a cualquiera con `module:terminal`.

Tres cosas que deliberadamente **no** hace, y avisa al terminar:

- **El primer usuario.** Pediría inventar una contraseña, y una generada que
  después nadie cambia es peor. Sin usuarios el agente responde 503 a todo.
- **El firewall.** Depende de la máquina, y abrir un puerto sin que se lo pidan
  es la clase de sorpresa que un instalador no debe dar.
- **Escuchar en todas las interfaces.** El default es `127.0.0.1`; para llegar
  desde otro dispositivo hay que pedir `--host 0.0.0.0` a propósito.

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
| Explorador de archivos | ✅ menú contextual, subir y descargar, portapapeles propio | `modules/explorer/` |
| Terminal | ✅ varias a la vez, panel propio, elección de carpeta, copiar y pegar | `modules/terminal/` |
| **Claude nativo** | ✅ **cerrado** | `modules/claude-native/`, `services/claude.js` |
| Claude en terminal | ✅ | `modules/claude/` — un PTY pelado, a propósito |
| Visor de archivos | ✅ editor CodeMirror 6, y vistas propias para markdown, imágenes y PDF | `modules/file/` |
| Buscador | ✅ ripgrep en streaming, con reemplazo global | `services/search.js`, `modules/search/` |
| Git | ✅ árbol, tres cubetas, stash, diff, detalle de commit, fetch/pull/push/rebase/checkout, conflictos, refresco automático | `services/git.js`, `modules/git/` |
| Canal de eventos | ✅ `/ws/events`: explorador y git se refrescan solos | `services/events.js`, `stores/eventos.ts` |
| Base de datos | ⬜ placeholder, y **sin icono en el rail** hasta que tenga contenido | `modules/db/` |

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
  (`deploy/instalar.sh`), no de código.
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
  ahí, nunca directo. Con el servicio instalado hay TLS y el respaldo no se usa,
  pero sigue haciendo falta: `npm run dev` no tiene certificado.
- **`rg --passthru` le agrega un salto de línea final al archivo que no lo
  tenía.** Imprime línea por línea, así que un archivo sin newline al final
  vuelve con uno. Sin corregirlo, buscar y reemplazar ensuciaría el diff de cada
  archivo que toca. Está resuelto en `services/search.js`; el test lo fija.
- **En el reemplazo, `$1` pegado a letras no es el grupo 1.** El motor de Rust
  lee `$1rem` como el grupo *llamado* `1rem`, que no existe, y lo reemplaza por
  nada. Hay que escribir `${1}rem`. No se puede arreglar del lado nuestro sin
  adivinar la intención, así que la interfaz lo dice en el campo.
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
- **`fs.watch` recursivo agota los inotify del sistema.** En Linux abre uno por
  subdirectorio, y un `node_modules` se lleva puesto el `max_user_watches` sin
  dar error: simplemente dejan de llegar eventos. Por eso el canal observa solo
  las carpetas desplegadas en el explorador, una por una y sin recursión.
- **En tablet no hay clic derecho, y la pulsación larga no se descubre sola.**
  Por eso cada fila del explorador tiene además un botón `⋯` visible. Y hace
  falta `-webkit-touch-callout: none`, o iOS abre su propio menú de selección
  encima del nuestro.
- **Servir un archivo en línea desde el mismo origen es un XSS.** Un `.html` o
  un `.js` del repositorio servidos con su `content-type` se ejecutarían con la
  cookie de sesión puesta. Por eso `/api/fs/raw` tiene una **lista blanca** —solo
  imágenes y PDF—, manda `nosniff`, y al SVG le agrega `Content-Security-Policy:
  sandbox`, porque un SVG es un documento y abierto directo en una pestaña sí
  ejecuta scripts. Todo lo demás baja por `/api/fs/download`, como adjunto.
- **`breaks: true` en marked arruina un README.** Convierte cada salto de línea
  del archivo en un `<br>`, así que un texto envuelto a 80 columnas se ve
  dentado. En el chat sí se quiere; en un archivo no. `renderMarkdown` lo toma
  por opción y el default es sin saltos duros.
- **En el terminal no se puede pegar con el gesto del sistema.** El textarea de
  xterm es invisible y de un píxel, así que mantener apretado sobre el terminal
  no encuentra nada editable y iOS ni ofrece «Pegar». Por eso hay un botón
  propio, en la barra de teclas y en la esquina. Y **leer el portapapeles no
  tiene respaldo**: `execCommand('paste')` está bloqueado en todos los
  navegadores, así que sin HTTPS solo queda pedirle al usuario que pegue en un
  campo.
- **Copiar desde el terminal en tablet no puede depender de seleccionar.** xterm
  pinta sobre un canvas y el gesto de selección del sistema no lo alcanza. Por
  eso el botón copia la selección **si la hay**, y si no lo que está en
  pantalla, que es casi siempre lo que se quiere.
- **Ajustar el terminal sin comprobar antes es un bucle.** `fit()` cambia el alto,
  eso dispara el `ResizeObserver`, y este vuelve a ajustar. Encima cada vuelta
  mandaba un resize al PTY y el prompt se redibujaba: en Android, donde `dvh` se
  mueve con la barra del navegador, se veía como un parpadeo con scroll cada
  segundo. Hay que preguntar con `proposeDimensions()` y solo actuar si cambian
  las filas o las columnas.
- **Pegar en el terminal va por `term.paste()`, nunca por el socket.** xterm
  sabe si la aplicación de adentro pidió *bracketed paste* y envuelve el texto.
  Mandarlo crudo hace que un bloque de varias líneas se ejecute línea por línea
  en cuanto llega el primer salto.
- **El fallback de SPA no puede tragarse los archivos que faltan.** Si
  `/assets/algo.js` devuelve el `index.html` con código 200, el navegador
  intenta ejecutar HTML como JavaScript y la aplicación queda **en blanco sin
  ningún error**. Pasa en cada despliegue: el build cambia el hash de los chunks
  y una pestaña abierta sigue pidiendo los viejos. Una ruta con extensión da
  404; solo las rutas sin extensión resuelven al index.
- **Nada quitaba las tareas en segundo plano ya terminadas.** Se guardaban en un
  `Map` por conversación y se reenviaban en cada reconexión, así que la barra
  quedaba fija con avisos de hace horas hasta cerrar la pestaña. Ahora vencen a
  los cinco minutos y hay un botón para descartarlas antes.
- **`getSessionMessages` no sirve para una conversación larga.** Reconstruye el
  hilo siguiendo la cadena de mensajes padre, y una **compactación la rompe**.
  Medido en una sesión de 4613 líneas: devolvió **143 mensajes de 1667**, solo
  70 de ellos presentes en ese archivo, cubriendo de la línea 102 a la 2240 y
  deteniéndose **doce horas antes del final**. Lo que se mostraba era el
  principio de la conversación, no lo último. Por eso `transcriptDeDisco` lee el
  `.jsonl` y **gana el que traiga más mensajes**: en las sesiones cortas
  coinciden, y el día que el SDK lo arregle vuelve a ganar él sin tocar nada.
- **El mismo id de sesión puede estar en dos proyectos, y hay que elegir bien.**
  Renombrar la carpeta de un proyecto deja una copia con el nombre viejo, y
  `readdir` no promete orden —el viejo suele ordenar antes. Leer el primero que
  aparezca mostraba una copia congelada: la conversación como estaba horas
  antes. Gana el de `mtime` más reciente, que es el que se está escribiendo.
- **El `cwd` de una sesión de Claude no es un valor único.** Se registra por
  mensaje y cambia cuando un subagente trabaja en otro directorio; hay sesiones
  con catorce rutas distintas. `listSessions` reporta solo una, así que **no
  sirve para decidir a qué proyecto pertenece** una conversación: eso lo dice
  dónde la guarda Claude Code, que es lo que selecciona `dir`. Se intentó
  filtrar por ese `cwd` y escondía sesiones legítimas.
- **Renombrar la carpeta del proyecto parte su historial de Claude.** Las
  sesiones se guardan en `~/.claude/projects/<ruta-con-guiones>/`, así que el
  nombre nuevo arranca vacío y las viejas siguen apuntando a la ruta anterior
  por su campo `cwd`. Mover los `.jsonl` no alcanza: hay que corregir ese campo,
  y **solo ese** —la ruta vieja dentro del contenido de los mensajes es parte de
  lo que se dijo.
- **npm 11 bloquea los install scripts.** Quedan aprobados en `allowScripts` del
  `package.json` raíz, que se commitea.

## Pendientes conocidos

En `docs/ARCHITECTURE.md` § *Deuda conocida*, y arriba en la tabla de módulos.
Los dos que más se notan:

- **Un directorio versionado que aparece después de suscribirse no se observa**:
  el aviso llega por el padre, pero lo que se edite adentro no se ve hasta
  reabrir el panel de git.
- **Las carpetas no se pueden arrastrar al explorador ni descargar**: para lo
  primero Safari de iPad no trae la API de entradas del navegador; para lo
  segundo habría que comprimir, y el agente no lo hace.
- **No hay editor de conflictos de tres paneles**: se puede quedarse con un lado
  entero, o editar el archivo con sus marcadores y marcarlo resuelto.
- **Las conversaciones de todos los devs van al mismo `~/.claude/projects`** con
  un agente compartido. La separación que hace `claude_sessions` es lógica, no
  del sistema de archivos.


## Bitácora de commits

Los commits los da Eddy a mano. Cuando una tanda de trabajo queda lista, su
mensaje se redacta **acá** y se espera; así la próxima sesión sabe qué se hizo
aunque el commit todavía no se haya dado.

**Una vez commiteado, la entrada se borra.** El registro pasa a ser `git log`,
que no puede quedar desincronizado con la realidad. Copiarlo acá solo hace que
este archivo crezca sin fin y empuje hacia abajo lo que sí se lee en cada
sesión: las reglas, el mapa y las trampas.

Lo que **no** se borra es lo aprendido: si una tanda dejó una lección, va a
*Trampas* o a `docs/ARCHITECTURE.md` antes de que la entrada desaparezca. La
bitácora es un buzón de salida, no un archivo histórico.

Formato: encabezado en una línea (imperativo, ≤72 caracteres), línea en blanco,
y el cuerpo explicando el *porqué* antes que el *qué*.

### Pendiente de commit — el chat mostraba el principio, no lo ultimo

```
Leer el transcript del disco cuando el SDK se queda corto

Abrir una conversacion larga mostraba su principio y nada reciente.
`getSessionMessages` reconstruye el hilo siguiendo la cadena de mensajes padre,
y una compactacion la rompe. Medido en una sesion de 4613 lineas: devolvio 143
mensajes de 1667, solo 70 de ellos presentes en ese archivo, cubriendo de la
linea 102 a la 2240 y deteniendose doce horas antes del final.

`transcriptDeDisco` lee el .jsonl y filtra a los mensajes de la conversacion.
Gana el que traiga mas: en las sesiones cortas los dos coinciden y no cambia
nada, y el dia que el SDK lo arregle vuelve a ganar el sin tocar codigo.

Es una dependencia del formato en disco, que es lo que este modulo evita en todo
lo demas. Se acepta porque el riesgo es bajo: las lineas del archivo tienen la
misma forma que los SessionMessage del SDK, asi que no hay traduccion que se
pueda romper. Y el archivo se busca por nombre en todos los proyectos en vez de
derivar la carpeta de la ruta: esa codificacion no esta documentada, y adivinarla
es la clase de suposicion que falla en silencio.

El archivo se busca por nombre en todos los proyectos, y cuando aparece en mas
de uno gana el de mtime mas reciente. Eso ultimo no es un detalle: renombrar la
carpeta de un proyecto deja una copia con el nombre viejo, `readdir` no promete
orden y el viejo suele ordenar antes, asi que leer el primero mostraba una copia
congelada —la conversacion como estaba horas antes, con el ultimo mensaje viejo.

Cinco tests: el orden y el filtrado del ruido —el archivo trae snapshots,
titulos generados y estado interno—, que una linea corrupta no corte la lectura,
el desempate por mtime entre dos proyectos, y que sin archivo devuelva vacio.
```

### Pendiente de commit — tareas que se quedaban pegadas, y flechas visibles

```
Las tareas terminadas se olvidan, y las flechas del terminal se encuentran

TAREAS EN SEGUNDO PLANO

Nada las quitaba nunca. Se guardaban en un Map por conversacion y se reenviaban
en cada reconexion, asi que la barra quedaba fija con avisos de tareas
terminadas hace horas, hasta cerrar la pestaña.

Ahora una tarea terminada vence a los cinco minutos —se conserva un rato porque
el aviso de que termino es justamente lo que se quiere ver— y hay un boton para
descartarlas antes, que es el gesto de "entendido".

FLECHAS DEL TERMINAL

Ya existian y ya funcionaban: se comprobo que `\x1b[A` recupera el comando
anterior a traves del PTY. El problema era encontrarlas. Estaban en la posicion
cuatro de trece, en una barra que scrollea, asi que en una tablet angosta
quedaban fuera de la vista y parecia que no existian.

Ahora `↑` y `↓` van al frente, junto a esc, y anchas como ella. Reutilizar el
comando anterior es media terminal cuando no hay teclado.
```

### Pendiente de commit — el historial de Claude ya no rotula mal

```
Atribuir cada sesion de Claude a la carpeta por la que se pregunto

El historial se veia "mezclado": conversaciones de este repositorio aparecian
rotuladas con la ruta de otro. La causa no era el SDK, era la etiqueta.

El `cwd` de una sesion NO es un valor unico: se registra por mensaje y cambia
cuando un subagente trabaja en otro directorio. Hay sesiones con catorce rutas
distintas. `listSessions` reporta solo una de ellas, y usarla para etiquetar da
una carpeta cualquiera de las que la sesion toco.

Lo que si identifica a que proyecto pertenece una conversacion es donde la
guarda Claude Code, que es exactamente lo que selecciona `dir`. Asi que la
sesion se atribuye a la carpeta por la que se pregunto, y el cwd muestreado
queda como dato secundario.
```

