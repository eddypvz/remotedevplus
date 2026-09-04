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

Los commits los da Eddy a mano. Cada tanda de trabajo deja aquí su mensaje
redactado, en orden cronológico inverso, para que la próxima sesión sepa qué
entró y cuándo — sin depender de que el commit ya se haya dado.

Formato: encabezado en una línea (imperativo, ≤72 caracteres), línea en blanco,
y el cuerpo explicando el *porqué* antes que el *qué*.

### Pendiente de commit — todo lo de abajo, en un solo mensaje

Las diez tandas siguientes se hicieron en una sola sesión y no se commitearon
por separado. Este es el mensaje que las cubre a todas; las entradas de abajo
quedan como detalle de cada una.

```
Cerrar la brecha entre "funciona" y "se usa todos los días"

Cada sesión real desde la tablet chocaba con algo: el explorador no veía los
archivos que escribía Claude, no se podía pegar en el terminal, git pedía
refrescar a mano, y el agente moría al cerrar la consola que lo lanzó.

- Instalador de systemd con TLS: certificado propio, autofirmado para las IP
  de la máquina, o ninguno si lo termina un proxy. Sin dominio ni CA de por
  medio.
- `/ws/events`, que estaba en el protocolo sin implementar: el explorador y el
  panel de git se refrescan solos. Se observan solo las carpetas a la vista;
  `fs.watch` recursivo agota los inotify del sistema sin avisar.
- Varias terminales a la vez, con panel propio. Copiar y pegar por botón: sobre
  un canvas no se puede seleccionar, y iOS no encuentra dónde ofrecer "Pegar".
- Menú contextual en el explorador —crear, renombrar, copiar, mover, borrar—
  por clic derecho, pulsación larga y botón visible. Subir y bajar archivos.
- El visor despacha por tipo: markdown formateado con alternancia a editor,
  imágenes y PDF. Servirlos en línea lleva lista blanca y `nosniff`: un .html
  del repositorio ejecutaría su script con la cookie puesta.
- Reemplazo global con ripgrep, no con una expresión regular de JavaScript: los
  motores difieren y reemplazar con otro es cómo se corrompe un proyecto.
- Conflictos de merge: quedarse con un lado, marcar resuelto, seguir, abortar.

Tres defectos que salieron de usarlo: el fallback de SPA devolvía el index con
código 200 para archivos que faltaban, y una pestaña abierta durante un
despliegue quedaba en blanco sin error; el terminal parpadeaba por un bucle
entre `fit()` y el ResizeObserver; y la cookie de sesión no salía `Secure`
detrás de un proxy.

Cuarenta y un tests nuevos, ciento diecinueve en total.
```

### Pendiente de commit — pantalla en blanco tras un despliegue

```
El fallback de SPA ya no se traga los archivos que faltan

Cualquier ruta que no fuera un archivo real devolvia el index.html con codigo
200, incluidas las de /assets/. Con una pestaña abierta durante un despliegue
eso deja la aplicacion en blanco: el build cambia el hash de cada chunk, la
pestaña vieja pide los anteriores, y el navegador recibe HTML donde esperaba
JavaScript. No hay error visible, no hay nada en el log del servidor —200 en
todos lados— y desde afuera parece que el servicio arranco mal.

Ahora una ruta con extension da 404 de verdad. El fallback sigue existiendo para
lo que fue pensado: recargar una ruta profunda de la SPA.

Ademas, si un chunk igual no carga, la pagina se recarga una vez sola. Es el
caso real de una tablet con la pestaña abierta desde ayer. La marca en
sessionStorage corta el bucle: si recargar tampoco alcanzo, el problema es otro
y conviene que el error se vea.
```

### Pendiente de commit — quitar del rail el icono de base de datos

```
Sacar del rail el icono de base de datos

El modulo es un placeholder. Un icono que abre una pestaña vacia promete algo
que no existe, y en una barra de seis iconos eso se nota.

El modulo sigue registrado a proposito: si alguien tenia una pestaña suya
guardada, `tabs.restore()` la descarta si el modulo no existe. Se vuelve a poner
en el rail cuando tenga contenido.
```

### Pendiente de commit — el terminal parpadeaba al volver de otra app

```
Cortar el bucle de redimensionado del terminal

`doFit()` llamaba a `fit()` y a `socket.resize()` sin comprobar nada. `fit()`
cambia el alto del terminal, eso dispara el ResizeObserver, y el observer vuelve
a llamar a `doFit()`. El ciclo se sostenia solo, y como cada vuelta mandaba un
resize al PTY, el prompt se redibujaba: en Android, donde `dvh` se mueve con la
barra del navegador, se veia como un parpadeo con scroll cada segundo al volver
de otra aplicacion.

Ahora se pregunta primero con `proposeDimensions()`, que devuelve las filas y
columnas que resultarian sin tocar nada, y si son las mismas que ya hay no se
hace nada. Ademas las rafagas del observer se agrupan en un solo ajuste por
cuadro con requestAnimationFrame, que de paso evita el aviso de "ResizeObserver
loop" del navegador.
```

### Pendiente de commit — sudo desde el terminal del IDE

```
Opcion para que el terminal del IDE permita sudo

No funcionaba, y no por descuido: la unidad lleva NoNewPrivileges, que anula el
bit setuid de sudo, y ProtectSystem=full, que deja /usr y /etc en solo lectura.
Lo segundo importa tanto como lo primero: permitir sudo dejando /etc en solo
lectura daria un sudo que arranca y despues falla al escribir, que es peor que
no tenerlo. Por eso `--permitir-sudo` quita las dos, no una.

Con la bandera puesta el terminal del IDE se comporta igual que una sesion SSH
de ese usuario: ni mas ni menos. En una maquina de un solo dueño no agrega
ningun acceso que no tuviera ya; con varios devs le da root a cualquiera que
tenga module:terminal, y ahi lo correcto sigue siendo un agente por dev.

El default no cambia: sigue restringido.
```

### Pendiente de commit — sacar del proyecto lo que era de una máquina

```
El instalador deja de saber de un servidor en particular

Tenia la ruta del certificado de la maquina donde se escribio como valor por
defecto. Degradaba bien —si no existe, se sirve por HTTP— pero era una fuga:
el proyecto no tiene por que conocer la ruta de un servidor concreto.

Ahora el certificado se pasa con --cert/--key, se genera con --autofirmado, o no
hay. La ruta de ese servidor vive en el script de ese servidor, fuera del
repositorio.
```

### Pendiente de commit — copiar del terminal y HTTPS sin dominio

```
Copiar desde el terminal, y un certificado propio para no depender de nada

COPIAR

Faltaba la otra mitad de pegar. En tablet no se puede seleccionar dentro del
terminal —xterm pinta sobre un canvas y el gesto del sistema no lo alcanza—, asi
que el boton copia la seleccion si la hay, y si no lo que esta en pantalla, que
es casi siempre lo que se quiere: la salida del comando recien corrido.

A diferencia de pegar, copiar si tiene respaldo sin HTTPS, asi que funciona
igual por HTTP.

HTTPS SIN DOMINIO NI CA

`--autofirmado` genera un certificado para el hostname y todas las IP de la
maquina. Se entra por https://<ip>:8790 sin que el navegador se queje del
nombre; de quien lo firmo si se queja, y hay que aceptarlo una vez por
dispositivo.

Esto es lo que hace que el proyecto no dependa de nada externo para tener TLS:
sin dominio, sin DNS y sin una autoridad certificadora propia instalada en los
dispositivos. Y con TLS el navegador da secure context, que es lo que hace que
pegar en el terminal funcione de una en vez de pedir un dialogo.

DE PASO

La cookie de sesion no salia marcada `Secure` detras de un proxy aunque el
agente ya sabia deducirlo: mod_proxy de Apache fija X-Forwarded-For, -Host y
-Server pero NO -Proto, que es justo el dato que falta. Se arregla en el vhost,
no en el proyecto, pero conviene saberlo al documentar el modo C.
```

### Pendiente de commit — pegar en el terminal

```
Pegar en el terminal, que en tablet no era posible

Mantener apretado sobre el terminal no ofrece "Pegar": el textarea de xterm es
invisible y de un pixel, asi que iOS no encuentra nada editable donde mostrar el
menu. En la practica el terminal era de solo escritura desde la tablet.

Ahora hay un boton, en la barra de teclas accesorias y tambien en la esquina
—esa barra se puede ocultar, y quedarse sin forma de pegar no es aceptable.

Va por `term.paste()` y no por el socket: xterm sabe si la aplicacion de adentro
pidio bracketed paste y envuelve el texto como corresponde. Mandarlo crudo hace
que un bloque de varias lineas se ejecute linea por linea en cuanto llega el
primer salto, que es la forma clasica de ejecutar medio comando sin querer.

Leer el portapapeles no tiene respaldo posible: execCommand('paste') esta
bloqueado en todos los navegadores desde hace anios, y con razon —seria espiar
lo que el usuario copio en otra aplicacion. Sin HTTPS solo queda pedirle que
pegue en un campo, asi que el dialogo gana modo multilinea. Con el agente detras
de HTTPS el boton pega directo y el dialogo no aparece.
```

### Pendiente de commit — poder correr detrás de un proxy

```
El agente sabe vivir detrás de un proxy inverso

Hasta ahora "detrás de un proxy" era un modo documentado pero a medias: existía
`--trust-proxy` como bandera suelta, y nada más.

- La cookie de sesión se marcaba `secure` mirando SOLO el TLS del propio agente.
  Detrás de un proxy que termina TLS, el agente habla HTTP y el navegador HTTPS,
  así que la cookie quedaba sin marcar en una conexión que sí era segura. Ahora
  también mira el protocolo real del request, que Fastify deduce de
  X-Forwarded-Proto cuando se confía en el proxy.
- `REMOTEDEVPLUS_TRUST_PROXY` como variable de entorno, para que la unidad de
  systemd lo active sin tocar el archivo de config de la máquina.
- El instalador gana `--tras-proxy`: escucha en loopback, no pide certificado
  —cifrar dos veces sobre loopback no aporta nada y obligaría a mantener dos
  copias— y calla los dos avisos que en ese modo sobran.

Nada de esto ata el proyecto a un servidor web. El agente se sigue sirviendo a
sí mismo y sabe hacer TLS solo; esto es para cuando la máquina ya tiene un 443
ocupado y conviene entrar por ahí.
```

### Pendiente de commit — el visor deja de ser solo un editor

```
Vista formateada para markdown, imágenes y PDF

Abrir un PNG y encontrarse con "archivo binario" es la clase de detalle que hace
que una herramienta se sienta pobre. Ahora el módulo despacha por tipo en vez de
meter todo en CodeMirror.

- Markdown formateado por defecto, con un segmentado para pasar a editor y
  volver. Un README se abre para leerlo; editarlo es lo excepcional. La
  preferencia no se recuerda entre archivos, a propósito.
- El editor se crea recién cuando hace falta y de ahí en más se conserva:
  destruirlo al volver a la vista perdería el deshacer y los cambios sin
  guardar.
- Imágenes con damero detrás, para distinguir la transparencia del fondo del
  panel, y alternancia entre ajustar y tamaño real.
- PDF en el visor del navegador y no uno propio: ya sabe paginar, buscar y hacer
  zoom con dos dedos, y en iPad eso funciona mejor que cualquier cosa que
  pudiéramos escribir.

Ni la imagen ni el PDF pasan por `/api/fs/read`: los pide el navegador a
`/api/fs/raw`. Bajar un JPEG de 4MB como texto para tirarlo sería absurdo, y por
wifi se nota.

SERVIR ARCHIVOS EN LÍNEA

`raw` está separado de `download` porque el riesgo es distinto. `attachment` con
octet-stream se puede usar con cualquier archivo; `inline` no: servir un .html
del repositorio desde el mismo origen ejecutaría su script con la cookie de
sesión puesta.

Por eso lleva lista blanca —solo imágenes y PDF—, `nosniff` para que el
navegador no adivine otro tipo, y `Content-Security-Policy: sandbox` en los SVG,
que son documentos y abiertos en una pestaña sí ejecutan scripts. Al PDF no se
le aplica porque deshabilitaría el visor integrado.

MARKDOWN COMPARTIDO

`markdown.ts` y `Markdown.vue` salen de `claude-native` a `ui/`: ya no son del
módulo de Claude. Y `breaks` pasa a ser opción en vez de estar fijo en true.
Estaba bien para el chat, donde quien escribe espera que sus saltos se respeten,
pero convierte cada línea de un README envuelto a 80 columnas en un <br>: se
vería dentado, que es justo lo contrario de lo que se pedía.

Cinco tests nuevos. El que importa: un .html y un .js del repositorio se
rechazan con 415, y un SVG con un script adentro se sirve neutralizado.
```

### Pendiente de commit — servicio, TLS, descarga, reemplazo y conflictos

```
Servicio de systemd con TLS, descarga, reemplazo global y conflictos de merge

Cinco huecos que quedaban entre "funciona" y "se usa todos los días".

SERVICIO Y TLS

El agente se levantaba a mano y moría con la sesión. `deploy/instalar.sh` lo
registra en systemd y lo deja andando, incluido después de reiniciar. Es lo
único del proyecto que pide root, y hace dos cosas que el agente no puede hacer
solo: escribir en /etc y registrar la unidad. El agente sigue sin privilegios.

La plantilla estática que había no servía: apuntaba a /opt cuando el código está
en otro lado, y systemd no expande variables en WorkingDirectory. Ahora la
unidad se genera con la ruta real.

El instalador es portable: comprueba node antes de tocar nada —buscándolo como
el usuario, porque si vino de nvm root no lo vería, y con el mínimo leído de
`engines` para que no diverja—, compila el SPA si falta dist/, y toma el
certificado por parámetro en vez de suponer el del devserver. Lo que no hace lo
dice al terminar: crear el primer usuario, abrir el firewall, y escuchar fuera
de loopback. Los tres piden una decisión que no le corresponde tomar a un
script.

El README se puso al día de paso. Decía que git y el buscador estaban
"planificados" cuando hace rato que funcionan, no mencionaba la mitad de lo que
hay, y pedía Node 22 en un lugar y 24 en otro.

De paso queda TLS. El certificado del devserver ya cubre los nombres de la
máquina —incluido el de Tailscale—, así que no hay que generar nada ni
reinstalar la CA en ningún dispositivo. Se copia a /etc/remotedevplus/tls/ con
dueño explícito en vez de compartir el original: meter al usuario en www-data le
daría lectura de mucho más de lo necesario, y setfacl no está instalado.

Con HTTPS el navegador da secure context, así que el portapapeles deja de
depender del respaldo con execCommand y la contraseña deja de viajar en claro.

DESCARGAR ARCHIVOS

El par de la subida, y en tablet pesa: sin esto no había forma de sacar un log o
un dump del servidor. Va como attachment, con el nombre en ASCII y en UTF-8 para
que un acento no se pierda. Carpetas no: habría que comprimirlas.

REEMPLAZO GLOBAL

Lo hace ripgrep con `--passthru --replace`, no una expresión regular de
JavaScript. Es la única forma de que lo que se reemplaza sea exactamente lo que
se mostró: los motores de Rust y de JavaScript no coinciden en clases Unicode,
en \b ni en los cuantificadores perezosos, y reemplazar con un motor distinto
del que buscó es cómo se corrompe un proyecto en silencio.

Dos trampas que costaron encontrar y quedaron con test:

- `--passthru` le agrega un salto de línea final al archivo que no lo tenía.
  Sin corregirlo, cada reemplazo ensuciaría el diff de todo archivo sin newline.
- En modo literal hay que escapar los `$` del reemplazo: `--replace` interpreta
  `$1` aun con `--fixed-strings`, así que reemplazar por "US$100" dejaba "US".

CONFLICTOS DE MERGE

El panel los mostraba y nada más. Ahora se resuelven: quedarse con un lado
entero, o editar el archivo y marcarlo resuelto. Los botones se nombran según la
operación en curso, porque "ours" y "theirs" significan lo contrario en un
rebase que en un merge y nombrarlos "el mío" engañaría.

El estado ahora dice qué operación quedó a medias, leyendo los archivos de
control de .git: porcelain v2 no lo dice, y deducirlo mal significa ofrecer
"rebase --continue" en medio de un merge. Con eso se puede continuar o abortar
desde el panel; `continuar` va con GIT_EDITOR=true o el proceso queda colgado
esperando que alguien cierre un editor que no existe.

DE PASO

Un test de workspaces fallaba una de cada diez veces: llamaba a `setRoots`, que
es async, sin await, y la lectura corría contra la escritura. Se veía solo bajo
carga; los archivos de test nuevos la aumentaron lo suficiente como para
destaparlo.

Dieciocho tests nuevos. Descargar fuera de las raíces se rechaza, el reemplazo
no toca lo que está afuera ni lo que excluye el filtro, y un rebase a medias no
se confunde con un merge.
```

### Pendiente de commit — el explorador se vuelve usable con el dedo

```
Menú contextual y subida de archivos en el explorador; git se refresca solo

GIT AUTOMÁTICO

El panel de git ya no depende del botón de refresh. El agente observa dos cosas
y las dos hacen falta: `.git` cubre lo que hace git —commit, checkout, stash,
fetch, rebase, o un `git add` desde la terminal—, y los directorios con archivos
versionados cubren lo otro, que alguien edite un archivo y el árbol de trabajo
deje de ser el que muestra el panel.

Cuáles son esos directorios lo dice git, con `ls-files`. Recorrer el disco
habría metido `node_modules` en la lista; git ya sabe qué está ignorado. Van
topados a 400 y ordenados por profundidad, para que si hay que recortar se
conserve lo que más se mira.

El refresco es barato por defecto: estado y stash. El grafo, las ramas y los 300
commits solo se recalculan cuando el estado dice que HEAD es otro.

EXPLORADOR

Tenía dos botones y nada más. Ahora tiene las operaciones que uno espera —crear,
renombrar, duplicar, copiar, cortar, pegar, eliminar— y una forma de meter
archivos al proyecto, que en una tablet no existía por ningún lado.

- Menú contextual por clic derecho, por pulsación larga y por un botón `⋯`
  visible en cada fila. Los tres, porque en tablet no hay clic derecho y la
  pulsación larga no se descubre sola. Va teleportado a body: un ancestro con
  overflow ya recortó menús dos veces en este proyecto.
- Portapapeles propio, interno a la aplicación. El del navegador no maneja
  archivos del servidor y fuera de HTTPS ni siquiera existe. Copiar guarda
  rutas; pegar le pide al agente que copie o mueva, así que el archivo nunca
  pasa por el navegador —que es lo único que funciona con una carpeta de 2GB.
- Subida por selector de archivos y por arrastrar y soltar. Bytes crudos con el
  nombre en la query, sin multipart: una dependencia menos y un parser menos que
  mantener. Uno por petición y en serie, para que el progreso sea real y un
  archivo que falla no arrastre a los demás.
- El nombre libre lo elige el agente, no el navegador: `notas (2).md`. Mirando
  el listado desde el cliente sería una carrera, y dos pestañas subiendo a la
  vez se pisarían el archivo.
- Los diálogos ganan campo de texto. Un modal y no una fila editable en el
  árbol: en tablet la fila puede quedar debajo del teclado virtual, y ahí no se
  ve lo que se escribe.

RUTAS NUEVAS

`/api/fs/copy`, `/api/fs/move`, `/api/fs/upload` y `/api/fs/create`. Las cuatro
toman el directorio destino y un nombre, nunca una ruta final armada por el
cliente: un nombre con barras crearía subdirectorios donde el usuario cree que
pone un archivo. `mkdir` pasó a la misma forma.

Diez tests nuevos. Los que importan: un nombre con `..` no escribe fuera, copiar
y mover se rechazan en las dos direcciones cuando un extremo cae fuera de las
raíces, una carpeta no se puede copiar dentro de sí misma, y con `fs:read` pero
sin `fs:write` no se escribe nada.
```

### Pendiente de commit — terminales múltiples y canal de eventos

```
Varias terminales a la vez y un canal de eventos para el explorador

TERMINALES

Una terminal era "la terminal de esta carpeta": abrirla dos veces en el mismo
directorio devolvía la misma sesión. Eso alcanzaba mientras el terminal fuera
algo que se abre de reojo, pero no cuando es donde se trabaja —un servidor
corriendo en una y los comandos en otra es el caso normal, no el raro.

Ahora la sesión se crea ANTES que la pestaña y la pestaña se identifica por el
id del PTY. Dos terminales en la misma carpeta son dos pestañas distintas, y el
panel puede llevar a la de cada sesión sin buscarla a tientas.

- El icono del rail abre un panel con las terminales vivas, no una terminal
  nueva. Es la misma decisión que en Claude: lo normal es volver a una que ya
  existe. Las terminadas se listan aparte.
- "Nueva terminal" pasa por el diálogo de carpeta, igual que git. Con un
  workspace de backend y frontend, en cuál abrirla no se puede adivinar.
- `adopt` gana un modo exacto para las shells. El rescate por carpeta —"si no
  encuentro el id, agarro alguna del mismo cwd"— existía para que Claude
  sobreviviera a una recarga, pero con varias shells por carpeta engancharía dos
  pestañas al mismo PTY y se pisarían el teclado.

CANAL DE EVENTOS

`/ws/events` estaba declarado en el protocolo desde el principio y sin
implementar, así que el explorador no se enteraba de nada: había que refrescar a
mano, y el caso más común era el peor —Claude Code escribiendo archivos que el
árbol no mostraba.

- Un socket para toda la aplicación, no uno por módulo: una tablet que suspende
  la pestaña reconecta uno solo, y al volver del segundo plano se reconecta sin
  esperar el backoff.
- Se observan exactamente las carpetas desplegadas. `fs.watch` recursivo en
  Linux abre un inotify por subdirectorio y un node_modules agota el
  max_user_watches sin dar error: dejan de llegar eventos y nada lo dice.
- Un inotify por directorio y no por cliente, con contador de suscriptores. Sin
  eso, cada recarga de la página filtraba un watcher.
- La frontera de rutas se aplica al suscribir, igual que en cualquier lectura:
  suscribirse no es una forma de mirar afuera.
- Los avisos se agrupan a 150ms. Guardar un archivo dispara varios eventos del
  sistema y un npm install dispara miles.
- El canal también lleva `pty:exit`, para que el panel de terminales no muestre
  viva una que ya terminó aunque su pestaña no esté abierta.

Ocho tests nuevos, incluido el que importa: un directorio fuera de las raíces no
se puede observar, ni por ruta hermana ni con "..".
```

### Ya commiteado — `2a27654` «Iniciado proyecto»

Cubre todo el proyecto: el repositorio se borró y se volvió a clonar para
dejar un solo commit en lugar de los 24 que se habían acumulado. El rename a
`remotedevplus` entró en la misma tanda. El mensaje quedó abreviado al
commitear; el redactado va abajo por si sirve de referencia.

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
