# remotedevplus

Un IDE web para desarrollo remoto, **optimizado para tablet**. Nace de dos
problemas concretos de code-server: no está pensado para iPad, y su panel de git
es inservible.

El agente **se sirve a sí mismo**: no necesita Apache, nginx ni un vhost. Un
comando y la app está arriba.

```bash
git clone <url> remotedevplus && cd remotedevplus
npm install
npm run build
node apps/agent/src/cli.js user add <tu-usuario> --admin
node apps/agent/src/cli.js serve --root /var/www
```

Abra `http://127.0.0.1:8790`. Para dejarlo corriendo siempre y llegar desde la
tablet, ver *[Instalarlo como servicio](#instalarlo-como-servicio)*.

## Qué hay

| | |
|---|---|
| **Explorador** | árbol, menú contextual (crear, renombrar, duplicar, copiar, cortar, pegar, eliminar), subir y descargar archivos |
| **Editor** | CodeMirror 6 con resaltado, plegado y búsqueda; guarda al disco |
| **Visor** | markdown formateado (los README se abren así, y se alterna a editor), imágenes con damero de transparencia y PDF en el visor del navegador |
| **Terminal** | PTY real, varias a la vez, con panel propio para saltar entre ellas; copiar y pegar con botón, que en tablet no existen de otra forma |
| **Claude Code** | dos clientes que conviven: el nativo sobre el Agent SDK y la TUI en un PTY |
| **Git** | árbol de commits, tres cubetas de trabajo, stash, diff, fetch/pull/push/rebase/checkout, conflictos de merge |
| **Buscador** | ripgrep en streaming, con reemplazo global |
| **Workspaces** | conjuntos de carpetas por usuario, guardados en la base |
| **Usuarios** | login, permisos por módulo, raíces por usuario |
| **Canal de eventos** | el explorador y el panel de git se refrescan solos cuando cambia el disco |
| **Base de datos** | ⬜ pendiente |

Lo que falta y por qué está en
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), sección *Deuda conocida*. Los dos
grandes: el autocompletado con LSP y el cliente de base de datos.

## Pensado para tablet, no adaptado

No es una etiqueta de marketing; condiciona el código:

- **CodeMirror 6 y no Monaco.** Monaco es justamente por qué code-server se
  siente mal en iPad: pesa unos 5MB, no tiene selección táctil real y pelea con
  el teclado virtual.
- **Nada depende del hover.** En el panel de git los botones de cada archivo
  están puestos, no aparecen al pasar el mouse — que en tablet no existe.
- **Barra de teclas accesorias** con Esc, Tab y Shift+Tab, sin las cuales Claude
  Code no se maneja en iPad. Y Ctrl pegajoso, que es la única forma de hacer
  Ctrl+C sin teclado físico.
- **El menú contextual se abre de tres formas**: clic derecho, pulsación larga y
  un botón `⋯` visible. En tablet no hay clic derecho y la pulsación larga no se
  descubre sola.
- **`dvh` y nunca `vh`**: en iPad `vh` mide el viewport grande y el contenido
  queda debajo de la barra del navegador.

## Los dos clientes de Claude

Conviven a propósito, y se elige al abrir:

| | Nativo | Terminal |
|---|---|---|
| Interfaz | propia | la TUI de Claude Code, tal cual |
| Historial | sí — se lee del disco y se reanuda | dentro de la TUI, no recuperable desde afuera |
| Permisos | diálogo | dentro de la TUI |
| Modelo y modo | en caliente | al lanzar |
| Respuesta | se escribe token a token | tal cual la pinta la TUI |
| Novedades de Claude Code | hay que implementarlas | aparecen solas |

El nativo usa el **Claude Agent SDK**, que autentica con el login que ya tiene
el CLI de Claude Code: consume la suscripción y no pide `ANTHROPIC_API_KEY`.

El historial no es una copia nuestra. Claude Code guarda sus sesiones en
`~/.claude/projects/<ruta-del-proyecto>/<uuid>.jsonl` y el SDK las expone
(`listSessions`, `getSessionMessages`), así que se leen de la fuente en vez de
mantener dos versiones de la misma cosa — y las conversaciones que se tengan
desde la terminal, o desde VS Code, aparecen acá también. En la base solo se
guarda de quién es cada sesión: todas viven bajo el mismo usuario de sistema, y
sin ese índice un usuario vería los resúmenes de las conversaciones de otro.

## Por qué la sesión de Claude Code no se pierde

Es la mitad del valor del proyecto, así que vale explicarlo.

El PTY vive en el agente, no en el navegador, y cada uno guarda un *ring buffer*
de su salida indexado por offset absoluto en bytes. El cliente cuenta los bytes
que recibió, y ese número **es** el `seq` del protocolo: al reconectar pide
`?since=N` y el agente reproduce solo el delta.

Entonces cuando el iPad suspende la pestaña o se cae el wifi, Claude Code sigue
trabajando y al volver el terminal continúa el stream — no es un repintado de
pantalla, el scrollback queda intacto.

Sobrevive a desconexiones y a recargas de página. No sobrevive a reiniciar el
agente; eso era el precio de no usar tmux, y está razonado en el documento.

## Comandos

```bash
npm run check                    # typecheck + build + tests
npm run sdk:check                # ¿qué cambió en el Agent SDK?
npm test                         # solo los tests
npm run dev                      # agente + Vite con recarga en caliente
npm run build                    # compila la web a apps/web/dist
npm run serve -- --root /var/www # solo el agente, sirviendo el build

npm run user -- list
npm run user -- add ana --role reviewer
npm run user -- perms ana module:git git:read module:search
npm run user -- roots ana www          # limitar a una raíz
npm run user -- passwd ana             # cierra sus sesiones
npm run user -- disable ana
```

`node apps/agent/src/cli.js` sin argumentos lista todas las opciones.

## Permisos

Strings planos, y los roles son paquetes con nombre sobre la misma lista:

| | |
|---|---|
| `*` | super admin |
| `module:file` `module:terminal` `module:claude` `module:git` `module:db` `module:search` `module:users` | qué módulos ve |
| `fs:read` `fs:write` | archivos |
| `terminal:spawn` | abrir terminales |
| `git:read` `git:write` `db:read` `db:write` | por módulo |
| `users:manage` `audit:read` | administración |

Roles listos: `admin`, `dev`, `reviewer`.

**La autorización se aplica en el agente, no en la UI.** Que el frontend esconda
un icono no es seguridad: cada ruta declara su permiso y un único hook lo
verifica. Y cada usuario puede limitarse a un subconjunto de las raíces.

Un límite honesto: **quien tiene terminal tiene todo lo que tiene el usuario del
sistema.** Los permisos separan responsabilidades, y son contención real solo
para usuarios sin terminal. Aislamiento verdadero se consigue con un agente por
dev — lo instala `deploy/instalar.sh`.

## Exponerlo

El agente escucha en `127.0.0.1` por defecto. Tres modos:

```bash
# A · loopback, para desarrollar remotedevplus mismo
node apps/agent/src/cli.js serve

# B · HTTPS directo, sin proxy. El recomendado para una tablet.
node apps/agent/src/cli.js serve --host 0.0.0.0 \
  --tls-cert /ruta/cert.pem --tls-key /ruta/key.pem

# C · detrás de nginx/apache/Caddy (ejemplos en deploy/)
node apps/agent/src/cli.js serve --trust-proxy
```

En el modo C el TLS lo termina el proxy, y `--trust-proxy` no es opcional: sin
él el agente ve la IP del proxy en vez de la del cliente —lo que arruina el
bloqueo por intentos de login— y no marca la cookie como `secure`, porque estaría
mirando su propio TLS en vez del de la conexión real. El proxy tiene que
reenviar los WebSocket, o la terminal no abre.

El modo B es el recomendado y no por comodidad: `navigator.clipboard` solo
funciona en secure context, y sin portapapeles un editor de código en iPad no
sirve.

## Instalarlo como servicio

Arrancarlo a mano sirve para probarlo; para usarlo todos los días conviene que
sobreviva a cerrar la terminal y a reiniciar la máquina.

```bash
sudo deploy/instalar.sh --host 0.0.0.0 \
  --cert /ruta/cert.pem --key /ruta/key.pem

node apps/agent/src/cli.js user add <tu-usuario> --admin   # solo la primera vez
```

| Opción | Qué hace |
|---|---|
| `--usuario <nombre>` | quién corre el agente. Default: quien invocó `sudo` |
| `--puerto <n>` | default `8790` |
| `--host <ip>` | interfaz donde escucha. Default `127.0.0.1` |
| `--cert <f>` `--key <f>` | certificado TLS que ya se tenga |
| `--permitir-sudo` | el terminal del IDE queda igual que una sesión SSH: `sudo` funciona |
| `--autofirmado` | genera un certificado propio para el hostname y las IP de la máquina |
| `--tras-proxy` | el agente va detrás de nginx/Apache, que termina TLS |
| `--sin-build` | no compilar aunque falte `dist/` |

Es **idempotente**: se puede volver a correr sin miedo, y hay que hacerlo si se
regenera el certificado, porque lo que lee el agente es una copia.

### HTTPS sin dominio ni autoridad certificadora

En una máquina cualquiera no hay dominio ni una CA propia instalada en los
dispositivos. Para eso está `--autofirmado`:

```bash
sudo deploy/instalar.sh --host 0.0.0.0 --autofirmado
```

Genera un certificado que cubre el hostname y **todas las IP de la máquina**,
así que se entra por `https://192.168.1.50:8790` sin que el navegador se queje
del nombre. Sí se queja de quién lo firmó: hay que aceptarlo una vez por
dispositivo.

Vale la pena aceptarlo. Sin HTTPS el navegador no da *secure context*, y eso no
es cosmético: `navigator.clipboard` directamente no existe, así que copiar cae a
un respaldo peor y **pegar en el terminal pasa a pedir un diálogo** en vez de
funcionar de una.

### Qué hace

Comprueba todo antes de tocar nada —dejar media instalación hecha y fallar es
peor que no empezar—, compila el SPA si falta `dist/`, copia el certificado a
`/etc/remotedevplus/tls/`, genera la unidad de systemd con la ruta real del
código y arranca el servicio. Si no arranca, muestra el registro y sale con
error en vez de decir que todo salió bien.

**Es lo único del proyecto que necesita root**, y solo para dos cosas que el
agente no puede hacer solo: escribir en `/etc` y registrar el servicio. El
agente sigue corriendo sin privilegios, como el usuario que se le indique.

### `sudo` desde el terminal del IDE

Por defecto **no funciona**, y no por descuido: la unidad lleva
`NoNewPrivileges`, que anula el bit setuid de `sudo`, y `ProtectSystem=full`,
que deja `/usr` y `/etc` en solo lectura.

```bash
sudo deploy/instalar.sh --permitir-sudo
```

quita las dos —van juntas, porque un `sudo` que arranca y después falla al
escribir en `/etc` es peor que no tenerlo— y el terminal del IDE pasa a
comportarse **igual que una sesión SSH** de ese usuario.

Cuándo tiene sentido: una máquina con un solo dueño, donde el IDE reemplaza al
terminal de SSH. Ahí no agrega ningún acceso que esa persona no tuviera ya.

Cuándo no: **con varios devs.** El permiso `module:terminal` pasaría a valer
root para cualquiera que lo tenga, aunque no le hayas dado una cuenta con sudo.
Ahí lo correcto es un agente por dev, cada uno como su propio usuario del
sistema — que es como está pensado.

### Qué NO hace, y por qué

Las tres las avisa al terminar, con el comando exacto:

- **Crear el primer usuario.** Haría falta inventar una contraseña, y una
  generada que después nadie cambia es peor que no tenerla. Sin usuarios el
  agente responde `503` a todo.
- **Abrir el puerto en el firewall.** Depende de la máquina, y abrirlo sin que
  se lo pidan es exactamente la sorpresa que un instalador no debe dar.
- **Escuchar fuera de loopback.** El default es `127.0.0.1`. Exponer un servicio
  en todas las interfaces es una decisión, no algo que pase de costado.

### Un agente por dev

La unidad es una plantilla, así que cada dev tiene el suyo:

```bash
sudo deploy/instalar.sh --usuario ana --puerto 8791
sudo systemctl status remotedevplus@ana
journalctl -u remotedevplus@ana -f
```

Esto es lo que hace innecesario un supervisor privilegiado: **el aislamiento
entre devs no sale de código dentro del agente, sale del sistema operativo.**
Cada uno corre como su propio usuario, con sus archivos, sus llaves SSH, sus
credenciales de Claude y sus procesos.

### En una máquina nueva

Además de los [requisitos](#requisitos) del proyecto hacen falta **systemd** y
**`runuser`**. El `npm install` y el build los hace el instalador.

El mínimo de Node lo lee de `engines` en el `package.json`, así que no puede
quedar desincronizado con lo que el proyecto declara. Y si Node vino de `nvm` o
`fnm` vive en el home del usuario y root no lo vería, así que lo busca primero
como el usuario que va a ejecutarlo.

### Dónde queda cada cosa

| | |
|---|---|
| `/etc/systemd/system/remotedevplus@.service` | la unidad, generada |
| `/etc/remotedevplus/<usuario>.env` | puerto, host y rutas del certificado |
| `/etc/remotedevplus/tls/` | copia del certificado, del usuario |
| `<repo>/data/remotedevplus.db` | usuarios, sesiones, workspaces |

### Desinstalar

```bash
sudo systemctl disable --now remotedevplus@<usuario>
sudo rm -rf /etc/systemd/system/remotedevplus@.service /etc/remotedevplus
sudo systemctl daemon-reload
```

La base de datos vive en el repositorio, así que no se toca.

Si va a internet, lea
[Si se publica en internet](docs/ARCHITECTURE.md#si-se-publica-en-internet)
antes: un bypass de auth acá no filtra datos, entrega una shell.

## Requisitos

Node 24 o más, por `node:sqlite` integrado. Nada más: **ripgrep viene con el
proyecto** (`@vscode/ripgrep`), así que el buscador funciona recién clonado. Se
puede apuntar a otro con `--rg-bin`.

`node-pty` es la única pieza nativa. Se usa
`@homebridge/node-pty-prebuilt-multiarch`, que trae binarios precompilados, para
que `npm install` funcione sin build tools — no hace falta `make` ni gcc. Los
scripts de instalación quedan aprobados en `allowScripts` del `package.json`, así
que npm 11 no los bloquea al clonar.

## El Agent SDK

Está en 0.x y se mueve rápido. `docs/sdk-surface.json` guarda una foto de su
superficie —opciones, funciones, tipos de mensaje, modos— y `npm run sdk:check`
la compara con la instalada: verde lo que apareció, rojo lo que se fue, y sale
con error solo si desapareció algo que usamos.

[docs/SDK.md](docs/SDK.md) tiene el inventario: usamos 9 de las 66 opciones, y
ahí está el resto ordenado por lo que aportaría, más lo aprendido a los golpes
que no figura en la documentación oficial.

## Tests

`node:test`, integrado en Node — sin dependencias. Cada archivo levanta su
propio directorio temporal y su propia base SQLite, así que no comparten estado
y el orden no importa.

| Archivo | Qué cubre |
|---|---|
| `tests/paths.test.js` | La frontera de rutas: traversal, symlinks que escapan, confusión de prefijo, las tres formas de `user.roots` |
| `tests/auth.test.js` | Login, revocación de sesión, bloqueo por IP, y que el tiempo de respuesta no revele si un usuario existe |
| `tests/users.test.js` | Las dos escaladas de privilegio (por raíces y por permisos) y la protección del último super admin |
| `tests/workspaces.test.js` | Que un workspace recorte el acceso sin otorgarlo, y que sea privado de su dueño |
| `tests/pty.test.js` | El ring buffer del scrollback y la lista blanca de banderas de Claude Code |
| `tests/claude.test.js` | La frontera y el aislamiento del cliente nativo. No habla con la API: automatizar una conversación real gastaría cuota en cada corrida |
| `tests/markdown.test.js` | Que el markdown de la conversación se sanee. Los resultados de herramientas traen contenido de archivos del proyecto, así que un README con un `<script>` llegaría al navegador |
| `tests/fs.test.js` | Subir, descargar, copiar y mover: que el nombre sea un nombre y no una ruta, que no se cruce la frontera en ninguna dirección, y que sin `fs:write` no se escriba nada |
| `tests/git.test.js` | El reparto de carriles del árbol, y los conflictos de merge: quedarse con un lado, marcar resuelto, continuar y abortar sin confundir un rebase con un merge |
| `tests/search.test.js` | La búsqueda en streaming y el reemplazo global: que no le agregue un salto de línea al archivo que no lo tenía, que un `$` literal sobreviva, y que respete los filtros |
| `tests/events.test.js` | El canal de eventos: que no se pueda observar fuera de las raíces, que dos clientes compartan un solo observador, y que cerrar la conexión no filtre ninguno |
| `tests/layout.test.js` | Las reglas de pestañas y sidebar, que son puro estado y se rompen sin ruido |

`npm run typecheck` no alcanza por sí solo: `vue-tsc` no detecta etiquetas HTML
mal cerradas en las plantillas. Por eso `check` corre también el build.

## Estructura

```
apps/agent/      daemon Node: Fastify + node-pty + node:sqlite
  src/paths.js     LA FRONTERA DE SEGURIDAD. Toda ruta pasa por acá
  src/hosts/       interfaz Host (LocalHost hoy, SshHost después)
  src/services/    auth, users, workspaces, pty, claude, git, search, events
  src/routes/      REST y WebSocket, cada ruta con su `requires`
apps/web/        Vue 3 + Vite → dist/, que sirve el propio agente
  src/layout/      rail, sidebar, workbench con pestañas
  src/modules/     cada módulo es una pestaña o un panel; se registran en modules/index.ts
  src/stores/      Pinia
packages/protocol/  tipos y constantes compartidas, JS plano sin build
tests/           node:test, sin dependencias
scripts/         dev.mjs, sdk-surface.mjs
docs/            ARCHITECTURE.md, SDK.md, sdk-surface.json
deploy/          instalar.sh, y EJEMPLOS de proxy que el sistema nunca toca
```
