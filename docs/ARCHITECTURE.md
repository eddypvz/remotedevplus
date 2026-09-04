# remotedevplus — Arquitectura

Un IDE web para desarrollo remoto, optimizado para tablet.

## Qué es y qué no es

Nace de dos problemas concretos de code-server: **no está optimizado para iPad**
(Monaco no tiene selección táctil real y pelea con el teclado virtual) y **su
panel de git es inservible**. remotedevplus resuelve esos dos, y a cambio renuncia
a ser un VS Code completo.

**Está en scope:** gestor de archivos, terminal interactiva con Claude Code,
buscador global, gestor de git a pantalla completa, visor/editor de archivos con
autocompletado, cliente de base de datos, gestor de usuarios.

**No está en scope:** administrar el servidor web, la base de datos o el sistema.
Ver *El agente no es privilegiado*, más abajo — no es una omisión, es la decisión
que hace que el proyecto sea replicable y seguro.

## Idioma de la interfaz

**Español formal, sin voseo.** "¿En qué carpeta desea abrir Claude Code?", no
"¿En qué carpeta abrís…?". Aplica a todo lo que ve el usuario —etiquetas,
mensajes de error del agente, salida del CLI— y también a los comentarios del
código, para que el registro no se parta en dos según dónde se lea.

En la práctica: tercera persona o impersonal antes que imperativo de segunda
("La elegida será el directorio de trabajo" antes que "Elegí una carpeta"), y
`su`/`sus` en vez de `tu`/`tus`.

**Los términos técnicos no se traducen.** `fetch`, `pull`, `push`, `rebase`,
`checkout`, `branch`, `stage`, `staged`, `untracked`, `stash`, `HEAD`, `commit`.
Traducirlos confunde a quien ya sabe git —"traer" y "bajar" no se distinguen si
uno piensa en fetch y pull— y no ayuda a quien no sabe, porque el término que va
a encontrar en cualquier documentación es el inglés. Tampoco se inventan verbos:
"Hacer commit", nunca "commitear".

## Principio rector

> El agente se sirve a sí mismo, corre sin privilegios, y no sabe que Apache existe.

Todo lo demás se deriva de esta frase. El agente es un proceso Node que un dev
clona, construye y levanta con un comando, en cualquier máquina con Node. No
requiere un servidor web adelante, no requiere root, no asume una distro.

### El agente no es privilegiado

Gestionar Apache/nginx/MySQL exige root o sudo, y eso rompe tres cosas:

- **Seguridad.** El agente ya expone una shell remota; eso es su propósito y es
  aceptable. Pero corriendo como root, cualquier fallo de auth o de path
  traversal pasa de "acceso a lo que el dev ya podía tocar" a compromiso total.
- **Replicabilidad.** Debian pone vhosts en `sites-available`, RHEL en `conf.d`,
  y el dev de al lado usa nginx o Caddy. Soportar eso es escribir un adaptador
  por combinación distro × servidor web. Es otro producto (Forge, Ploi, Coolify).
- **Contenedores.** Un daemon que necesita root y systemd no se contiene bien.

Lo que sí cabe, en fase 3 y **opcional**: un módulo *Servicios* que consulte
estado, haga tail de logs y reinicie servicios vía una whitelist estrecha de
sudoers. Si el operador no la configura, el módulo no aparece. Nunca dependencia.

No confundir con el **cliente de base de datos**, que sí está en scope: se
conecta a MySQL/Mongo/Redis con credenciales del config, como cualquier cliente.
Eso es distinto de administrar el servidor de base de datos.

## Por qué el backend es Node

El requisito que manda sobre todos los demás es la terminal interactiva. Claude
Code no imprime líneas: es una TUI que usa modo raw, pantalla alterna, secuencias
ANSI, `Shift+Tab` para cambiar de modo y `Esc` para interrumpir. Eso **no se
emula** con `exec()` ni `proc_open()` — necesita un PTY real (`forkpty(3)`).

En Node eso es `node-pty`, la misma librería que usa VS Code por debajo. PHP-FPM
además no puede sostener procesos de horas ni WebSockets. La decisión no es de
preferencia: es el único camino.

`node-pty` es la única pieza nativa del stack, y el paquete oficial **no** trae
binarios precompilados: sin `make` ni gcc, `npm install` falla. Por eso se usa
`@homebridge/node-pty-prebuilt-multiarch`, misma API con prebuilds, para que
clonar y correr no exija build tools. npm 11 además bloquea los scripts de
instalación por defecto; quedan aprobados en `allowScripts` del `package.json`
raíz, que se commitea, así que el que clona no aprueba nada.

## Topología

```
Tablet ──HTTPS──> remotedevplus-agent (Node, usuario del dev)
                    │
                    ├── GET  /            SPA construido (estático)
                    ├── REST /api/*       petición-respuesta
                    ├── WS   /ws/pty/:id  bytes crudos del PTY (binario)
                    └── WS   /ws/events   cambios de fs, estado de git
```

Tres modos de despliegue; el dev elige, el sistema no impone:

| Modo | Comando | Para qué |
|---|---|---|
| A | `remotedevplus serve` | HTTP en loopback; desarrollar remotedevplus mismo |
| B | `remotedevplus serve --tls-cert … --tls-key …` | **recomendado**: HTTPS directo, sin proxy |
| C | `remotedevplus serve --trust-proxy --base-path /dev` | detrás del nginx/apache que ya exista |

El modo B es el recomendado y no por comodidad: `navigator.clipboard` solo
funciona en secure context, y sin clipboard un editor de código en iPad no sirve.
Service workers y algunas APIs de teclado tienen la misma restricción.

`deploy/` lleva `apache.conf.example`, `nginx.conf.example`, `Caddyfile.example`,
un unit de systemd y un `docker-compose.yml`. Son **documentación**: el sistema
nunca los lee ni los escribe.

## El agente: servicios internos

Un solo proceso, Fastify, varios servicios dentro. Los que tocan una máquina lo
hacen siempre a través de un `Host`, nunca del filesystem directo (ver *Hosts*):

| Servicio | Responsabilidad | Notas |
|---|---|---|
| `fs` | listar, leer, escribir, stat, mover, borrar, watch | watchers **no recursivos**, solo de directorios expandidos |
| `pty` | registro de sesiones: spawn, resize, write, replay | ver *Persistencia de sesiones* |
| `search` | `rg --json` con salida en streaming | el binario viene con el proyecto; `--rg-bin` para usar otro |
| `git` | `git status --porcelain=v2`, diff, stage, commit | fase 2; se hace shell-out a `git`, no una reimplementación |
| `db` | cliente MySQL/Mongo/Redis | fase 3 |
| `lsp` | levanta intelephense / typescript-language-server, puentea JSON-RPC | fase 2 |
| `auth` | login, sesiones, autorización por permiso | ver *Autenticación, usuarios y permisos* |
| `users` | CRUD de usuarios y permisos | tabla en SQLite; CLI + UI |
| `hosts` | registro de hosts; `LocalHost` en fase 1, `SshHost` después | ver *Hosts* |
| `audit` | registro de logins, comandos y archivos tocados | tabla en SQLite |

### Persistencia de sesiones

Cada PTY guarda un **ring buffer** de su salida (los últimos ~2000 líneas de
bytes crudos) con un número de secuencia monótono. Cuando el iPad suspende la
pestaña o se cae el wifi, el proceso sigue vivo en el daemon; al reconectar, el
cliente manda el último `seq` que vio y recibe solo el delta. Claude Code no se
entera de que hubo una desconexión.

Se evaluó envolver cada sesión en `tmux`, que sobreviviría además a un reinicio
del agente. Se descartó para fase 1: el replay de tmux es un repintado de
pantalla, así que se pierde la continuidad del scrollback — que es exactamente lo
que este diseño preserva — y complica resize y captura de salida.

El `resize` del PTY debe propagarse (`pty.resize(cols, rows)`) en cada cambio de
tamaño del contenedor, o los cuadros de diálogo de Claude Code se rompen al
envolver líneas.

El agente corre como el usuario del dev, no como root, entre otras cosas para que
`claude` encuentre sus credenciales en `~/.claude`.

## Protocolo

- **REST/JSON** para petición-respuesta: árbol, leer archivo, guardar, estado de git.
- **Un WebSocket por terminal, frames binarios** = bytes crudos del PTY. Sin JSON
  ni base64 de por medio. Esto es lo que hace que se sienta instantáneo.
- **Un WebSocket de eventos** para lo que empuja el servidor: cambios en el fs,
  cambios de estado de git.

Los tipos de ambos lados viven en `packages/protocol`, compartidos entre agente
y web para que un cambio de mensaje rompa la compilación y no la ejecución.

## Autenticación, usuarios y permisos

El agente expone ejecución arbitraria de comandos. El modelo de amenaza por
defecto asume que solo devs autorizados alcanzan el puerto — Tailscale, VPN o
loopback. Para exponerlo a internet, ver *Tenencia y exposición a internet*: es
posible, pero cambia lo que la capa de auth tiene que contener.

### Modelo

Login con usuario y contraseña. Un usuario entra y queda desbloqueado lo que su
conjunto de permisos le permite. Los permisos son **strings planos**, y los roles
son solo paquetes con nombre sobre esa misma lista:

```
module:file  module:terminal  module:claude  module:git  module:db  module:search
fs:read      fs:write         terminal:spawn  git:write   users:manage
*                                              # super admin
```

Así, `admin` tiene `['*']`; otro usuario tiene `['module:git', 'git:write',
'fs:read']`; otro `['module:file', 'module:claude', 'fs:read', 'fs:write',
'terminal:spawn']`. No hace falta una tabla de roles para arrancar: se agrega
después como azúcar sobre los mismos strings, sin migrar nada.

Cada usuario puede además restringirse a un subconjunto de las raíces declaradas
(`user.roots`, por nombre; vacío = todas). Es casi gratis ahora y muy caro de
retrofitear.

### La regla que hay que respetar desde el día 1

**La autorización se aplica en el agente, no en la UI.** Que el frontend esconda
el icono de git no es seguridad: si el usuario no tiene `module:git`, el agente
tiene que rechazar `GET /api/git/status` igual.

Por eso cada ruta REST declara su permiso junto a su schema, y un único
`preHandler` lo aplica; cada canal WS lo valida en el upgrade:

```js
// apps/agent/src/routes/fs.js
app.get('/api/fs/read', { config: { requires: 'fs:read' } }, handler)
```

Un único hook `onRequest` en `server.js` lee ese `config.requires` y es el
solo lugar del sistema que decide si el request sigue.

Cablear esto ahora cuesta una línea por ruta. Retrofitearlo sobre sesenta
endpoints es una auditoría. Se hace desde la primera ruta, aunque en fase 1 solo
exista un super admin y ningún check falle nunca.

### Límite honesto de este modelo

**Quien tiene terminal tiene todo lo que tiene el usuario del sistema.** Un
usuario con `module:terminal` o `module:claude` puede hacer `cat` de cualquier
archivo, correr `git push` y entrar a MySQL, sin importar qué permisos le falten
en la UI. Los permisos separan *responsabilidades y superficie*, y son reales
para usuarios **sin** terminal (alguien que solo revisa git, por ejemplo).

Aislamiento verdadero exige usuarios de sistema separados. Eso **no** se resuelve
dentro del agente: se resuelve corriendo un agente por dev, cada uno como su
propio usuario (ver *Tenencia y exposición a internet*).

### Implementación

- **Almacenamiento:** SQLite vía **`node:sqlite`**, el módulo integrado de Node 24
  — funciona sin flag y sin dependencia nativa. Un archivo en `data/remotedevplus.db`
  con tablas `users`, `credentials`, `sessions`, `login_attempts` y `audit`. Es también donde luego caben
  ajustes por usuario y pestañas recientes.
- **Passkeys (WebAuthn):** método principal si el agente se expone a internet;
  la contraseña queda como fallback de red interna. Ver *Si se publica en
  internet*. En fase 1 se implementa contraseña, con el esquema de credenciales
  ya preparado para una tabla `credentials` de varios tipos por usuario.
- **Hash:** `scrypt` de `node:crypto`, N=2¹⁵, r=8, 64 bytes. Medido: 64ms, buen
  costo para un login. Se eligió sobre argon2 porque **no requiere módulo nativo**,
  coherente con la replicabilidad. Atención: hay que pasar `maxmem` explícito — con el
  default de 32MB, N=2¹⁵ falla.
- **Sesiones:** cookie httpOnly firmada, `SameSite=Lax`, con un id de sesión que
  vive en la tabla `sessions`. Server-side a propósito, no un JWT: permite revocar
  (cerrar sesión en todos los dispositivos, y expulsar de verdad a un usuario
  desactivado). TTL largo con expiración deslizante — 30 días — porque una tablet
  que pide login cada día es una tablet que no se usa.
- **Origin:** el upgrade de WebSocket valida `Origin` además de la cookie.
- **Fuerza bruta:** rate limit por IP y bloqueo temporal tras N intentos. Es la
  única puerta; sale barato.
- **Arranque:** sin usuarios en la base, el agente no sirve la app y muestra cómo
  crear el primero: `remotedevplus user add eddy --admin`. El CLI del agente también
  lleva `user list`, `user passwd`, `user perms` — para no depender de la UI si te
  quedas fuera.

### Frontera de rutas

Independiente de los permisos. Toda ruta que llega por la API se resuelve con
`realpath` y se valida contra las raíces del usuario; los symlinks que salen de
una raíz se rechazan. Esta validación es la frontera de seguridad del sistema.

Las raíces de un usuario tienen tres formas, en orden histórico:

| Valor | Significa |
|---|---|
| `null` o vacío | hereda las que se le pasaron al agente con `--root` |
| `['www']` | **legado**: nombres que filtran las del agente |
| `[{name, path}]` | **actual**: rutas propias, para que cada dev tenga su carpeta sin depender de una raíz global que la contenga |

Un super admin con `[{name:'disco', path:'/'}]` ve todo, lo que es coherente:
con terminal ya podía leer todo el disco de todos modos.

Con rutas libres aparecen dos escaladas de privilegio, y las dos están cerradas:
**solo se pueden otorgar raíces dentro de las propias**, y **solo permisos que
uno ya tiene** — si no, un `users:manage` se volvería super admin creando otro
usuario y entrando con él. El super admin es la excepción de la primera, porque
su límite ya es la máquina.

## Workspaces

Un workspace es un conjunto de carpetas con nombre, por usuario. El explorador
muestra solo esas, así que el backend y el frontend de un proyecto se abren
juntos sin ver todo lo demás.

Viven en la base y no en archivos sueltos tipo `.code-workspace`: así siguen al
usuario entre dispositivos sin sincronizar nada. La **selección**, en cambio, va
en `localStorage`, a propósito — permite tener el backend abierto en la laptop y
otro proyecto en la tablet al mismo tiempo.

**Un workspace no otorga acceso, lo recorta.** La frontera sigue siendo la lista
de raíces: cada carpeta se valida al guardarla y **otra vez al leerla**. Lo
segundo no es paranoia — si a un usuario le recortan las raíces después, sus
workspaces viejos tienen que dejar de mostrar lo que ya no le corresponde.

## Los dos clientes de Claude

Conviven y se elige al abrir. No es indecisión: resuelven cosas distintas.

| | Nativo | Terminal |
|---|---|---|
| Qué corre | el Agent SDK | el binario en un PTY |
| Interfaz | propia | la TUI, tal cual |
| Historial | leído del disco y reanudable | dentro de la TUI, no recuperable desde afuera |
| Permisos y preguntas | diálogo propio | dentro de la TUI |
| Modelo y modo | en caliente | al lanzar |
| Novedades de Claude Code | hay que implementarlas | aparecen solas |

El nativo existe porque el terminal tiene un techo: **la TUI dibuja sobre un
buffer de pantalla y no entrega los mensajes**, así que el historial es
irrecuperable desde afuera. Se intentó rodearla de controles —compositor
multilínea, selector de modelo, cabecera de sesión— y no alcanzó; ese intento se
revirtió y el terminal volvió a ser un terminal.

El SDK autentica con el login que ya tiene el CLI, así que consume la
suscripción y no pide `ANTHROPIC_API_KEY`. Los detalles de qué usamos, qué no y
cómo enterarse cuando cambia están en [SDK.md](SDK.md).

## Tenencia y exposición a internet

El sistema se diseña **mono-tenant**: un agente = una identidad de sistema = un
dev. Si algún día hace falta aislar devs de verdad, no se resuelve con código:

```
                    ┌─ remotedevplus@eddy.service   (usuario eddy,  :8790)
Internet ─> proxy ──┼─ remotedevplus@ana.service    (usuario ana,   :8791)
                    └─ remotedevplus@luis.service   (usuario luis,  :8792)
```

Un agente por dev, cada uno lanzado por systemd como su propio usuario. Da
aislamiento real de sistema operativo — archivos, llaves SSH, credenciales de
Claude, procesos — y el agente sigue siendo **cero privilegiado**. Dar de alta a
alguien es `adduser` + `systemctl enable remotedevplus@ana`: despliegue, no código.

Se descartó la alternativa de **un** agente sirviendo a **muchos** devs aislados,
porque exige un supervisor privilegiado (setuid o `systemd-run`) capaz de lanzar
PTYs como otros usuarios. Eso contradice *El agente no es privilegiado* y complica
fase 1 para resolver un problema que systemd ya resuelve gratis.

También se consideró un usuario de sistema compartido por todos los devs, con
clones separados y git como registro de quién hizo qué. **No aísla, y la
atribución es más débil de lo que parece:** el autor de un commit es un campo de
texto (`git commit --author=…`), la llave SSH de `~/.ssh` es una sola para todos,
los `.env` con credenciales de producción son legibles por cualquiera y `~/.claude`
se comparte. Es aceptable entre gente de confianza; no lo es con alguien a quien
no le darías una llave SSH del servidor.

El gestor de usuarios sigue teniendo función en mono-tenant: separar
responsabilidades **dentro** de un agente — un revisor con solo `module:git`.

### Pendiente: dónde viven las conversaciones de cada dev

Claude Code guarda sus sesiones en `~/.claude/projects/<ruta>/<uuid>.jsonl`, y
ese `~` es el del **usuario de sistema que corre el agente**. Con un agente
compartido, las conversaciones de todos los devs de remotedevplus terminan en el
mismo directorio.

En la aplicación están separadas: la tabla `claude_sessions` dice de quién es
cada una, y el listado filtra por eso. Pero **la separación es lógica, no del
sistema de archivos**: cualquiera con `terminal:spawn` puede leer los `.jsonl`
de los demás con un `cat`. Es el mismo límite que ya está documentado en
*Límite honesto de este modelo* — quien tiene terminal tiene todo — pero acá
duele más, porque una conversación con Claude suele traer contenido de archivos
y a veces credenciales.

Se resuelve igual que el resto del aislamiento: **un agente por dev**, cada uno
como su propio usuario de sistema (ver *Tenencia y exposición a internet*). Ahí
cada `~/.claude` es distinto y el problema desaparece sin código.

Alternativas que se consideraron y por qué no, si algún día hace falta un agente
compartido con varios devs:

- **Un `HOME` por usuario al lanzar el SDK.** El SDK toma el `HOME` del proceso;
  el agente es uno solo, así que habría que lanzar el proceso de Claude Code con
  un entorno distinto por conversación. Es factible, pero rompe que compartan
  credenciales y configuración con la terminal, que hoy es una ventaja.
- **Copiar el historial a nuestro SQLite.** Sería tener dos versiones de la
  misma cosa y perder que las conversaciones hechas desde la terminal o desde
  VS Code aparezcan en remotedevplus.

### Si se publica en internet

Un bypass de auth acá no filtra datos: entrega una shell. Eso hace este sistema
más riesgoso que una app web normal, y la mitigación va en ese orden:

1. **No abrir puerto.** Tailscale Funnel o Cloudflare Tunnel dan URL pública sin
   exponer un puerto, y Cloudflare Access pone una reja de identidad *delante*
   del agente. Máximo retorno por mínimo esfuerzo, y sigue siendo "publicado".
2. **Passkeys (WebAuthn)** como método principal; contraseña solo para red
   interna. Es el equivalente en navegador de una llave SSH: respaldada por
   hardware, imposible de phishear, y en iPad se resuelve con Face ID. Las llaves
   SSH no sirven acá — el navegador no puede leer `~/.ssh`.
3. **Rate limit y bloqueo** tras N intentos fallidos.
4. **Agente sin privilegios** y whitelist de raíces.
5. **Log de auditoría**: quién entró, qué comandos lanzó, qué archivos tocó.
   Opcional en VPN, indispensable publicado. Tabla `audit` en el mismo SQLite.

## Hosts: la costura para multi-host

### Por qué SSH no es el transporte

Vale la pena dejarlo escrito, porque es una pregunta que vuelve.

VS Code Remote-SSH **no ejecuta las operaciones por SSH**: entra por SSH,
**instala y arranca un servidor en la máquina remota** (`~/.vscode-server`) y usa
el canal SSH como túnel hacia ese servidor. El filesystem, los terminales y los
LSP corren allá. SSH es bootstrap y transporte, no el mecanismo de trabajo. La
mitad remota de Remote-SSH es, arquitectónicamente, este agente.

Y un navegador **no puede hablar SSH**: es TCP crudo, y el navegador no abre
sockets TCP (WebTransport es HTTP/3; Direct Sockets es solo Chrome con Isolated
Web Apps, nunca Safari de iPad). Quedan dos caminos, y ninguno sirve: un cliente
de escritorio que haga el SSH — mata la premisa de tablet — o un relay WS↔SSH,
que **es igual un servicio HTTP público**. Mueve la exposición, no la elimina.

Conclusión: SSH en el transporte no aporta seguridad. La seguridad está en la
capa de arriba, igual que en cualquier app web (ver arriba).

### Lo que sí se toma de Remote-SSH

Su ventaja real es **alcance**: funciona en cualquier máquina donde puedas entrar
por SSH, sin preparar nada del lado remoto. Eso es una *función*, no seguridad, y
encaja como capacidad del agente:

```
Tablet ──HTTPS──> agente (control plane)
                    ├── LocalHost  → fs, pty, git de esta máquina
                    └── SshHost    → ssh2 a otra máquina: copia el bundle
                                     del agente, lo arranca allá, tunelea
```

Las raíces pertenecen a un host: `roots: [{name, path, host: 'local' | 'prod'}]`.

**En fase 1 se implementa solo la costura:** una interfaz `Host` detrás de `fs`,
`pty`, `search` y `git`, con `LocalHost` como única implementación. Ningún
servicio toca el filesystem directo. Cuesta poco ahora y deja `SshHost` como algo
que se agrega sin reescribir nada. Es la misma clase de decisión que `requires`
en las rutas.

## Frontend: el layout

Tres regiones:

```
┌────┬──────────────┬─────────────────────────────┐
│ 48 │   SideBar    │  Workbench                  │
│ px │  240–320px   │  ┌─────┬─────┬─────┐        │
│    │  resizable   │  │ tab │ tab │ tab │        │
│rail│              │  └─────┴─────┴─────┘        │
│    │              │  contenido del módulo       │
└────┴──────────────┴─────────────────────────────┘
```

### Los iconos del rail tienen dos comportamientos

- **`panel`** — Explorador, Buscador, Configuración: togglean el SideBar. No
  abren pestaña.
- **`launcher`** — Git, Base de datos: abren una **pestaña** en el Workbench.

Claude es un caso mixto y por eso es `panel`: su icono abre el listado de
conversaciones en el sidebar, y desde ahí se lanzan las pestañas. Volver a
Claude casi siempre es seguir algo, no empezar de cero.

Esa distinción es el corazón de la UI: el gestor de git no es un panel angosto
al costado (el error de VS Code), es un módulo a pantalla completa.

### Cuándo se ve el sidebar

Se intentó que todos los módulos a pantalla completa lo colapsaran solos:

```ts
// Como estaba. Se revirtió.
const sidebarVisible = computed(() =>
  layout.userWantsSidebar && !tabs.active?.fullWidth
)
```

Estorbaba: el explorador se quiere abierto MIENTRAS se usa Claude Code o se lee
un archivo, que es justo cuando el colapso se activaba.

Hoy **lo declara cada módulo**, y solo lo pide el que ya cubre por su cuenta lo
que el sidebar ofrecería:

```ts
const sidebarVisible = computed(() =>
  layout.userWantsSidebar && !tabs.activeOcultaBarra
)
```

Git es el único con `ocultaBarra`: elige su carpeta al abrirse, así que el
explorador al costado no aporta nada y le quita ancho al árbol. Claude Code no
lo pide, que era el caso donde el colapso general molestaba.

La intención del usuario se guarda aparte del estado efectivo, así que al salir
de git el sidebar vuelve como estaba. El rail nunca se oculta: sin él no habría
cómo cambiar de módulo.

**Cambiar de pestaña desde el rail solo pasa cuando la barra no se puede
mostrar.** Fuera de git, tocar un icono de panel abre ese panel y deja la
pestaña como está: eso es lo que permite mirar archivos mientras se conversa con
Claude, o volver al panel de conversaciones sin cerrar el archivo que se estaba
leyendo. Desde git, en cambio, hay que salir del módulo para que el panel se
vea: se va a la pestaña de ese módulo, o se suelta la activa.

Un panel puede tener dueño —el listado de conversaciones es de
`claude-native`— pero solo cede al entrar a un módulo donde la barra se oculta.
Que cediera con cada cambio de pestaña rompía el mismo flujo.

En viewport angosto (<900px, iPad vertical) el SideBar deja de ser columna y pasa
a **drawer superpuesto** sobre el Workbench, para no comerse el ancho del editor.

## Módulos y pestañas

Todo lo que ocupa el Workbench es un módulo. Un solo contrato, y el sistema queda
extensible sin tocar el layout:

```ts
interface ModuleDef {
  id: 'file' | 'terminal' | 'claude' | 'git' | 'db' | 'search' | 'users'
  title: (ctx: TabContext) => string   // "app.vue" | "Claude Code" | "Git"
  icon: Component
  fullWidth?: boolean                  // ocupa todo el workbench (informativo)
  singleton?: boolean                  // ¿una sola pestaña de este módulo?
  needsFolder?: boolean                // pregunta la carpeta al lanzarse
  requires?: string                    // permiso; sin él, el módulo no se registra
  component: () => Promise<Component>  // chunk lazy
}
```

**Las pestañas no se desmontan.** Se montan como capas apiladas y las inactivas
se ocultan, con un `ResizeObserver` que reajusta xterm al volver a mostrarlas.
Desmontar la pestaña de Claude destruye el estado visual del terminal. El estado
autoritativo vive en el PTY del agente, así que en el peor caso hay un repintado.

Las pestañas abiertas se persisten en `localStorage`: al volver a abrir la tablet
se restauran, y los PTYs siguen vivos en el agente.

## Stack del frontend

Vue 3 + TypeScript + Vite + Pinia. Stores: `layout`, `tabs`, `workspace`,
`terminals`, `git`, `session`, `settings`.

El store `session` guarda el usuario y sus permisos; el registro de módulos y el
rail se construyen filtrando por `requires`, así que un usuario sin `module:git`
nunca ve el icono ni puede abrir la pestaña. Eso es UX, no seguridad — el agente
rechaza igual (ver *La regla que hay que respetar desde el día 1*).

- **Terminal:** `xterm.js` + addons `fit`, `webgl`, `unicode11`, `web-links`.
  El renderer WebGL no es opcional si se quiere fluidez con salida abundante.
- **Editor:** **CodeMirror 6**, no Monaco. Monaco es la razón por la que
  code-server se siente mal en iPad: pesa ~5MB, no tiene selección táctil real y
  pelea con el teclado virtual de iOS. CodeMirror 6 es un orden de magnitud más
  liviano, tiene soporte táctil de primera clase, gramáticas Lezer para PHP, JS,
  TS y Vue, y sí soporta LSP para el autocompletado de fase 2.
- **Árbol de archivos:** virtualizado (solo se renderizan las filas visibles).

### Rendimiento

Los puntos donde este tipo de app se vuelve pesada, y la decisión en cada uno:

- Watchers de fs **no recursivos**, solo de directorios expandidos. Un chokidar
  recursivo sobre un repo grande es el mayor costo de CPU del agente.
- Chunks lazy por módulo: el gestor de git y el de base de datos no se descargan
  hasta abrirlos.
- Frames binarios en el WS del PTY, sin serialización intermedia.
- Estado de git por polling con debounce, no watcheando `.git`.
- Resultados de búsqueda en streaming: se pintan mientras ripgrep sigue corriendo.

## Optimización para tablet

Se diseña desde el día 1, no se parcha después:

- **Barra de teclas accesorias** sobre el terminal: `Esc`, `Tab`, `Shift+Tab`,
  `Ctrl`, flechas, `|`, `/`. El teclado del iPad no tiene `Esc`, y sin `Esc` ni
  `Shift+Tab` Claude Code es literalmente inusable. Esta barra no es un extra.
- **Bracketed paste** para pegar desde el portapapeles de iPadOS.
- Targets táctiles ≥44px en rail, pestañas y filas del árbol.
- Ninguna afordancia solo-hover: todo lo que se puede hacer con hover debe poder
  hacerse con tap.
- `100dvh` en vez de `100vh`, `viewport-fit=cover` y safe-area insets.
- Control de tamaño de fuente del terminal; pinch-zoom desactivado dentro de él.

## Estructura del repositorio

```
remotedevplus/
├── apps/
│   ├── agent/            # daemon Node: Fastify + node-pty
│   │   ├── src/services/ # fs, pty, search, git, db, lsp, auth, users, audit
│   │   ├── src/hosts/    # Host interface, LocalHost, (SshHost fase 3)
│   │   └── src/db/       # node:sqlite, esquema y migraciones
│   └── web/              # Vue 3 + Vite  → dist/ lo sirve el propio agente
│       └── src/
│           ├── layout/   # ActivityBar, SideBar, Workbench, TabBar
│           ├── modules/  # file, terminal, claude, git, db, search, users
│           └── stores/
├── packages/
│   └── protocol/         # tipos TS compartidos de REST y WS
├── data/                 # remotedevplus.db (gitignored)
├── deploy/               # EJEMPLOS: apache, nginx, Caddy, systemd, docker
└── docs/ARCHITECTURE.md
```

npm workspaces, sin tooling de monorepo adicional.

```bash
git clone <url> && cd remotedevplus
npm install && npm run build
node apps/agent --root /var/www
```

`npm run dev` levanta el agente en watch y Vite. El puerto de Vite sale de
`VITE_PORT` en `.env`: si el dev necesita correr dos frontends a la vez, lo
cambia. remotedevplus no gestiona eso.

## Fases

**Fase 1 — el núcleo.** ✅ Shell del layout, explorador, terminal y Claude Code
con reconexión por ring buffer, barra de teclas accesorias, el agente
sirviéndose a sí mismo, y todo el andamiaje de auth: login, sesiones en SQLite,
`requires` en cada ruta y canal, filtrado del rail. La interfaz `Host` con
`LocalHost` como única implementación.

**Fase 1.5.** Parcial.

- ✅ Gestor de usuarios, con raíces por usuario y los guardarraíles de escalada.
- ✅ Editor con CodeMirror 6: resaltado por lenguaje, plegado, búsqueda, y la
  paleta salida de los tokens del tema para que no se vea como un recuadro
  ajeno. Las gramáticas se cargan bajo demanda, una por chunk.
- ✅ Buscador global con ripgrep, en streaming: los resultados se pintan a
  medida que caen. El binario viene empaquetado (`@vscode/ripgrep`), no se
  depende de que esté en el sistema.

**Fuera del plan original**, salidos del uso real: temas claro y oscuro,
workspaces, y el cliente nativo de Claude sobre el Agent SDK.

**Fase 2.** Parcial.

- ✅ Gestor de git a pantalla completa: árbol de commits con carriles calculados
  en el agente, las tres cubetas de trabajo siempre visibles, stash con el
  detalle de qué toca cada entrada, y diff coloreado.
- ⬜ Autocompletado vía LSP (intelephense para PHP,
  typescript-language-server para JS/TS).

**Fase 3.** Cliente de base de datos. `SshHost`: abrir carpetas de otras
máquinas, con bootstrap del bundle y túnel. Passkeys y log de auditoría, si se
decide exponer a internet. Módulo *Servicios* opcional. Distribución como
`npx remotedevplus`.

## Deuda conocida

- **`/ws/events` está definido en el protocolo pero sin implementar**, así que
  el explorador no se refresca solo cuando cambian archivos en disco. Es lo que
  haría que escribir un archivo con Claude se vea al instante en el árbol.
- **Las conversaciones de todos los devs van al mismo `~/.claude/projects`** con
  un agente compartido. Ver *Pendiente: dónde viven las conversaciones de cada
  dev*.
