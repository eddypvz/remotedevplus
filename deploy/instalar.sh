#!/usr/bin/env bash
#
# Instala remotedevplus como servicio de systemd.
#
#   sudo deploy/instalar.sh [opciones]
#
#     --usuario <nombre>   quién corre el agente (default: quien invocó sudo)
#     --puerto  <n>        default 8790
#     --host    <ip>       interfaz donde escucha. Default 127.0.0.1: solo esta
#                          máquina. Para llegar desde otro dispositivo hace
#                          falta 0.0.0.0, y entonces conviene TLS y un firewall.
#     --cert <f> --key <f> certificado TLS. Si no se indican se busca el del
#                          devserver, y si tampoco está, se sirve por HTTP.
#     --permitir-sudo      el terminal del IDE queda igual que una sesión SSH:
#                          `sudo` funciona. Ver la advertencia más abajo.
#     --autofirmado        genera un certificado propio para esta máquina, con
#                          su hostname y sus IP. No hace falta dominio ni CA: el
#                          navegador avisa una vez por dispositivo y se acepta.
#     --tras-proxy         el agente va detrás de nginx/Apache, que termina TLS
#     --sin-build          no compilar aunque falte dist/
#
# Es lo único del proyecto que necesita root, y hace dos cosas que el agente no
# puede hacer solo: escribir en /etc y registrar el servicio. El agente sigue
# corriendo sin privilegios, como el usuario que se le indique.
#
# Es idempotente. Hay que volver a correrlo si se regenera el certificado,
# porque lo que lee el agente es una copia.
set -euo pipefail

USUARIO="${SUDO_USER:-$USER}"
PUERTO=8790
HOST=127.0.0.1
CRT=""
KEY=""
BUILD=1
PROXY=0
AUTOFIRMADO=0
SUDO=0

while [ $# -gt 0 ]; do
    case "$1" in
        --usuario) USUARIO="$2"; shift 2 ;;
        --puerto)  PUERTO="$2";  shift 2 ;;
        --host)    HOST="$2";    shift 2 ;;
        --cert)    CRT="$2";     shift 2 ;;
        --key)     KEY="$2";     shift 2 ;;
        --permitir-sudo) SUDO=1; shift ;;
        --autofirmado) AUTOFIRMADO=1; shift ;;
        --tras-proxy) PROXY=1;   shift ;;
        --sin-build) BUILD=0;    shift ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) echo "Opción desconocida: $1" >&2; exit 1 ;;
    esac
done

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ETC=/etc/remotedevplus
UNIDAD=/etc/systemd/system/remotedevplus@.service

# Sin default: el certificado se pasa o se genera. Poner acá la ruta de una
# máquina concreta haría que el proyecto supiera de un servidor en particular, y
# en cualquier otra la ruta no existiría.

fatal() { echo "  ERROR: $*" >&2; exit 1; }

# --- 0. Comprobaciones ----------------------------------------------------
#
# Todas antes de tocar nada: dejar media instalación hecha y fallar es peor que
# no empezar.
[ "$(id -u)" -eq 0 ] || fatal "necesita root: sudo deploy/instalar.sh"
id "$USUARIO" >/dev/null 2>&1 || fatal "no existe el usuario $USUARIO"
command -v systemctl >/dev/null || fatal "no hay systemd en esta máquina"

# `node` puede venir de nvm o fnm, y entonces vive en el home del usuario y root
# no lo ve. Se busca primero como el usuario, que es quien lo va a ejecutar.
NODE="$(runuser -l "$USUARIO" -c 'command -v node' 2>/dev/null || true)"
[ -n "$NODE" ] || NODE="$(command -v node || true)"
# El mínimo sale de `engines` del package.json, no escrito acá: dos números que
# hay que acordarse de mover juntos terminan divergiendo.
MINIMO="$("$NODE" -p "(require('$RAIZ/package.json').engines.node.match(/[0-9]+/)||[24])[0]" 2>/dev/null || echo 24)"
[ -n "$NODE" ] || fatal "no se encontró node. Hace falta Node $MINIMO o superior"
VERSION="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$VERSION" -ge "$MINIMO" ] \
    || fatal "node $VERSION es muy viejo; hace falta $MINIMO o superior (node:sqlite sin bandera)"

echo "== remotedevplus =="
echo "   usuario:  $USUARIO"
echo "   código:   $RAIZ"
echo "   node:     $NODE ($("$NODE" -v))"
echo "   escucha:  $HOST:$PUERTO"

# --- 1. Dependencias y build ----------------------------------------------
#
# El agente sirve el SPA desde apps/web/dist, que está en .gitignore: un clon
# recién hecho no lo tiene, y sin esto el servicio arrancaría verde sirviendo
# solo la API, con el navegador viendo un 404.
como_usuario() { runuser -l "$USUARIO" -c "cd '$RAIZ' && $1"; }

if [ "$BUILD" -eq 1 ] && [ ! -f "$RAIZ/apps/web/dist/index.html" ]; then
    echo "   falta el build del SPA; compilando…"
    [ -d "$RAIZ/node_modules" ] || como_usuario "npm install" >/dev/null
    como_usuario "npm run build" >/dev/null
    echo "   build listo"
fi

# --- 2. TLS ---------------------------------------------------------------
#
# Se copia en vez de compartir el original por grupo o por ACL. Agregar al
# usuario a www-data le daría lectura de todo lo que ese grupo puede leer, que
# es mucho más de lo que hace falta.
install -d -m 755 "$ETC"

# Certificado propio, para una máquina sin dominio ni CA.
#
# Cubre el hostname y todas las IP de la máquina, que es lo que permite entrar
# por `https://192.168.1.50:8790` sin que el navegador se queje del nombre. Que
# no lo firme nadie conocido es otra cosa: hay que aceptarlo una vez en cada
# dispositivo. A cambio, el navegador da secure context y el portapapeles
# funciona de verdad.
if [ "$AUTOFIRMADO" -eq 1 ] && [ "$PROXY" -eq 0 ]; then
    command -v openssl >/dev/null || fatal "hace falta openssl para --autofirmado"
    install -d -m 750 -o "$USUARIO" -g "$USUARIO" "$ETC/tls"
    if [ -s "$ETC/tls/servidor.crt" ] && openssl x509 -in "$ETC/tls/servidor.crt" -noout -checkend 2592000 2>/dev/null; then
        echo "   TLS:      certificado propio, todavía vigente"
    else
        NOMBRE="$(hostname)"
        SAN="DNS:$NOMBRE,DNS:localhost,IP:127.0.0.1"
        for ip in $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do
            SAN="$SAN,IP:$ip"
        done
        openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
            -keyout "$ETC/tls/servidor.key" -out "$ETC/tls/servidor.crt" \
            -subj "/CN=$NOMBRE" -addext "subjectAltName=$SAN" 2>/dev/null \
            || fatal "openssl no pudo generar el certificado"
        chown "$USUARIO:$USUARIO" "$ETC/tls/servidor.crt" "$ETC/tls/servidor.key"
        chmod 644 "$ETC/tls/servidor.crt"; chmod 600 "$ETC/tls/servidor.key"
        echo "   TLS:      certificado propio generado para $SAN"
    fi
    CRT="$ETC/tls/servidor.crt"
    KEY="$ETC/tls/servidor.key"
fi

if [ "$PROXY" -eq 1 ]; then
    # El TLS lo termina el proxy. Darle también un certificado al agente sería
    # cifrar dos veces sobre loopback, y obligaría a mantener dos copias.
    TLS_CERT=""; TLS_KEY=""
    echo "   TLS:      lo termina el proxy"
elif [ -r "$CRT" ] && [ -r "$KEY" ]; then
    install -d -m 750 -o "$USUARIO" -g "$USUARIO" "$ETC/tls"
    install -m 644 -o "$USUARIO" -g "$USUARIO" "$CRT" "$ETC/tls/servidor.crt"
    install -m 600 -o "$USUARIO" -g "$USUARIO" "$KEY" "$ETC/tls/servidor.key"
    TLS_CERT="$ETC/tls/servidor.crt"
    TLS_KEY="$ETC/tls/servidor.key"
    echo "   TLS:      sí, copiado de $CRT"
else
    TLS_CERT=""; TLS_KEY=""
    echo "   TLS:      no"
fi

# --- 3. Configuración del servicio ----------------------------------------
#
# Se reescribe entero cada vez, para que volver a correr el script repare una
# edición a mano que haya quedado mal.
ENV_FILE="$ETC/$USUARIO.env"
{
    echo "# Generado por deploy/instalar.sh. Se reescribe al volver a correrlo."
    echo "REMOTEDEVPLUS_PORT=$PUERTO"
    echo "REMOTEDEVPLUS_HOST=$HOST"
    [ -n "$TLS_CERT" ] && echo "REMOTEDEVPLUS_TLS_CERT=$TLS_CERT"
    [ -n "$TLS_KEY" ] && echo "REMOTEDEVPLUS_TLS_KEY=$TLS_KEY"
    [ "$PROXY" -eq 1 ] && echo "REMOTEDEVPLUS_TRUST_PROXY=1"
} > "$ENV_FILE"
chmod 640 "$ENV_FILE"
chgrp "$USUARIO" "$ENV_FILE"

# --- 4. La unidad ---------------------------------------------------------
#
# El aislamiento del proceso.
#
# Por defecto se restringe: `NoNewPrivileges` anula el bit setuid, así que
# `sudo` no funciona ni aunque el usuario del sistema pueda usarlo, y
# `ProtectSystem=full` deja /usr y /etc en solo lectura. Es lo correcto cuando
# hay varios devs y a alguno se le dio terminal sin darle una cuenta con sudo.
#
# Con `--permitir-sudo` no queda ninguna: el terminal del IDE pasa a comportarse
# igual que una sesión SSH de ese usuario, ni más ni menos. En una máquina de un
# solo dueño eso no agrega ningún acceso que no tuviera ya por SSH; con varios
# devs, sí — le da root a cualquiera que tenga `module:terminal`.
#
# Las dos van juntas a propósito. Permitir sudo dejando /etc en solo lectura
# daría un sudo que arranca y después falla al escribir, que es peor que no
# tenerlo.
if [ "$SUDO" -eq 1 ]; then
    AISLAMIENTO="# Sin restricciones: el terminal equivale a una sesión SSH (--permitir-sudo).
"
else
    AISLAMIENTO="# El agente solo necesita leer y escribir lo que el dev ya podía tocar.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
"
fi

#
# Se genera en vez de copiarse tal cual porque systemd no expande variables en
# WorkingDirectory: la ruta del código tiene que quedar escrita.
cat > "$UNIDAD" <<UNIT
# Generado por deploy/instalar.sh desde $RAIZ. No editar a mano.
#
# Un agente por dev: remotedevplus@eddy, remotedevplus@ana. El aislamiento entre
# devs no sale de código dentro del agente, sale de que cada uno corre como su
# propio usuario del sistema, con sus archivos, sus llaves SSH y sus procesos.
[Unit]
Description=remotedevplus (agente de %i)
After=network.target

[Service]
Type=simple
User=%i
WorkingDirectory=$RAIZ
Environment=NODE_ENV=production
EnvironmentFile=-$ETC/%i.env
ExecStart=$NODE $RAIZ/apps/agent/src/cli.js serve
Restart=on-failure
RestartSec=2

$AISLAMIENTO
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "remotedevplus@$USUARIO" >/dev/null
systemctl restart "remotedevplus@$USUARIO"
sleep 2

if ! systemctl is-active --quiet "remotedevplus@$USUARIO"; then
    echo
    echo "   El servicio no arrancó. Lo que dijo:"
    journalctl -u "remotedevplus@$USUARIO" -n 15 --no-pager | sed 's/^/     /'
    exit 1
fi

# --- 5. Qué le falta a esta instalación -----------------------------------
#
# Sin usuarios el agente responde 503 a todo. No se crea uno acá porque hace
# falta una contraseña, y una generada que después nadie cambia es peor.
echo
if [ "$PROXY" -eq 1 ]; then
    echo "   Arriba en http://$HOST:$PUERTO, detrás del proxy."
    echo "   El proxy tiene que reenviar los WebSocket, o la terminal no abre."
else
    ESQUEMA=$([ -n "$TLS_CERT" ] && echo https || echo http)
    DESTINO=$([ "$HOST" = "0.0.0.0" ] && echo "$(hostname -f 2>/dev/null || hostname)" || echo "$HOST")
    echo "   Arriba en $ESQUEMA://$DESTINO:$PUERTO"
fi

# `user list` imprime "(sin usuarios)" cuando la base está vacía. Se busca ese
# marcador y no la ausencia de filas: un fallo del comando no debe hacer creer
# que el usuario existe.
if como_usuario "$NODE apps/agent/src/cli.js user list" 2>/dev/null | grep -q 'sin usuarios'; then
    echo
    echo "   FALTA el primer usuario, sin él la aplicación responde 503:"
    echo "     cd $RAIZ && node apps/agent/src/cli.js user add <nombre> --admin"
fi
# Detrás de un proxy escuchar en loopback es lo correcto, y el TLS no es asunto
# del agente: los dos avisos sobrarían y solo confundirían.
if [ "$PROXY" -eq 0 ]; then
    if [ "$HOST" != "0.0.0.0" ]; then
        echo
        echo "   Solo responde desde esta máquina. Para llegar desde otro"
        echo "   dispositivo: --host 0.0.0.0, y abrir el puerto $PUERTO en el firewall."
    fi
    if [ -z "$TLS_CERT" ]; then
        echo
        echo "   Sin TLS el navegador no da secure context: el portapapeles cae a un"
        echo "   respaldo peor y la contraseña viaja en claro."
        echo "   La forma más simple: volver a correr con --autofirmado."
    fi
fi
echo
if [ "$SUDO" -eq 1 ]; then
    echo "   El terminal permite sudo: equivale a una sesión SSH de $USUARIO."
    echo "   Quien entre con permiso de terminal puede hacer todo lo que puede $USUARIO."
else
    echo "   El terminal NO permite sudo. Se habilita con --permitir-sudo."
fi
echo
echo "   Registro en vivo:  journalctl -u remotedevplus@$USUARIO -f"
