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

Abra `http://127.0.0.1:8790`. Para entrar desde la tablet, ver *Exponerlo*.

## Estado

**Fase 1 funcional, más el cliente nativo de Claude.** Explorador de archivos,
workspaces, terminal, Claude Code en dos sabores, login con permisos por módulo,
gestor de usuarios y editor con CodeMirror 6.

El gestor de git, el buscador global, el autocompletado con LSP y el cliente de
base de datos están planificados y el layout ya los espera — los iconos abren
paneles que dicen en qué fase llegan. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
dev — ver `deploy/remotedevplus@.service`.

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

El modo B es el recomendado y no por comodidad: `navigator.clipboard` solo
funciona en secure context, y sin portapapeles un editor de código en iPad no
sirve.

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

`npm run typecheck` no alcanza por sí solo: `vue-tsc` no detecta etiquetas HTML
mal cerradas en las plantillas. Por eso `check` corre también el build.

## Estructura

```
apps/agent/      daemon Node: Fastify + node-pty + node:sqlite
  src/hosts/       interfaz Host (LocalHost hoy, SshHost después)
  src/services/    fs, pty, auth, users, audit
  src/routes/      REST y WebSocket, cada ruta con su `requires`
apps/web/        Vue 3 + Vite → dist/, que sirve el propio agente
  src/layout/      rail, sidebar, workbench con pestañas
  src/modules/     cada módulo es una pestaña; se registran en modules/index.ts
tests/           node:test, sin dependencias
packages/protocol/  tipos y constantes compartidas, sin build
deploy/          EJEMPLOS de proxy y systemd; el sistema nunca los toca
```
