import { createReadStream } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';
import { LIMITS } from '@remotedevplus/protocol';

/**
 * Tipos que se pueden servir para verlos dentro de la aplicación.
 *
 * Es una lista blanca y no un mapa de conveniencia. Servir un archivo con un
 * `content-type` adivinado desde el mismo origen que la aplicación es un XSS:
 * un `.html` del repositorio se ejecutaría con la cookie de sesión puesta. Acá
 * solo entran imágenes y PDF, que el navegador no ejecuta.
 */
const TIPOS_EN_LINEA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

/**
 * Un nombre de archivo, no una ruta.
 *
 * `paths.js` ya impide salirse de las raíces, pero un nombre con barras crearía
 * subdirectorios donde el usuario cree que pone un archivo, y `..` daría una
 * ruta que resuelve adentro pero no donde se está mirando. Acá se exige que sea
 * un nombre a secas.
 */
function nombreValido(nombre) {
  return typeof nombre === 'string'
    && nombre.length > 0 && nombre.length <= 255
    && !nombre.includes('/') && !nombre.includes('\\')
    && nombre !== '.' && nombre !== '..'
    && !nombre.includes('\0');
}

export default async function fsRoutes(app, { hosts, guard, audit }) {
  /**
   * Un nombre libre dentro de un directorio: `notas.md`, `notas (2).md`, …
   *
   * Lo resuelve el agente y no el navegador porque solo acá se puede mirar el
   * directorio en el momento de escribir. Que el cliente proponga un nombre
   * mirando un listado viejo es una carrera: dos pestañas subiendo a la vez se
   * pisarían el archivo.
   */
  async function nombreLibre(host, dir, nombre) {
    const ext = extname(nombre);
    const base = nombre.slice(0, nombre.length - ext.length);
    for (let i = 1; i < 500; i++) {
      const intento = i === 1 ? nombre : `${base} (${i})${ext}`;
      if (!(await host.stat(join(dir, intento)))) return intento;
    }
    const err = new Error(`Hay demasiados archivos llamados ${nombre}`);
    err.statusCode = 409;
    throw err;
  }

  /** El directorio destino de un copiar o mover, validado. */
  async function destino(user, raw) {
    const d = await guard.resolvePath(user, raw, { mustExist: true });
    const host = hosts.get(d.root.host);
    if ((await host.stat(d.path))?.kind !== 'dir') {
      const err = new Error('El destino no es un directorio');
      err.statusCode = 400;
      throw err;
    }
    return { ...d, host };
  }

  app.get('/api/fs/roots', { config: { requires: 'fs:read' } }, async (req) => ({
    roots: await guard.visibleRoots(req.user),
    hosts: hosts.list(),
  }));

  app.get('/api/fs/list', { config: { requires: 'fs:read' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
    const host = hosts.get(root.host);
    const st = await host.stat(path);
    if (st?.kind !== 'dir') {
      const err = new Error('No es un directorio');
      err.statusCode = 400;
      throw err;
    }
    return { path, entries: await host.list(path) };
  });

  app.get('/api/fs/read', { config: { requires: 'fs:read' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
    const host = hosts.get(root.host);
    const file = await host.readFile(path);
    return { path, ...file };
  });

  /**
   * Bajar un archivo al dispositivo.
   *
   * El par de la subida, y en tablet pesa más de lo que parece: sin esto no hay
   * forma de sacar un log, un dump o un export del servidor. Va como
   * `attachment` para que el navegador lo guarde en vez de intentar mostrarlo
   * —un `.md` o un `.json` abiertos en la pestaña no son lo que se pidió.
   */
  app.get('/api/fs/download', { config: { requires: 'fs:read' } }, async (req, reply) => {
    const { path, root } = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
    const host = hosts.get(root.host);
    const st = await host.stat(path);
    if (st?.kind !== 'file') {
      const err = new Error('Solo se pueden descargar archivos; una carpeta habría que comprimirla');
      err.statusCode = 400;
      throw err;
    }
    const nombre = basename(path);
    audit.log(req.user.id, 'fs.download', { path, bytes: st.size }, req.ip);
    reply
      .type('application/octet-stream')
      .header('content-length', String(st.size ?? 0))
      // El nombre va dos veces: `filename` en ASCII para los clientes viejos y
      // `filename*` en UTF-8 para que un acento no se pierda.
      .header('content-disposition',
        `attachment; filename="${nombre.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; `
        + `filename*=UTF-8''${encodeURIComponent(nombre)}`);
    return reply.send(createReadStream(path));
  });

  /**
   * Servir un archivo para verlo dentro de la aplicación.
   *
   * Separado de `download` a propósito: aquel manda `attachment` y el navegador
   * lo guarda. Este manda `inline`, que es lo que hace falta para un `<img>` o
   * un `<iframe>`, y por eso está mucho más restringido — ver `TIPOS_EN_LINEA`.
   */
  app.get('/api/fs/raw', { config: { requires: 'fs:read' } }, async (req, reply) => {
    const { path, root } = await guard.resolvePath(req.user, req.query.path, { mustExist: true });
    const tipo = TIPOS_EN_LINEA[extname(path).toLowerCase()];
    if (!tipo) {
      const err = new Error('Ese tipo de archivo no se puede mostrar en línea');
      err.statusCode = 415;
      throw err;
    }
    const host = hosts.get(root.host);
    const st = await host.stat(path);
    if (st?.kind !== 'file') {
      const err = new Error('No es un archivo');
      err.statusCode = 400;
      throw err;
    }
    reply
      .type(tipo)
      .header('content-length', String(st.size ?? 0))
      .header('content-disposition', 'inline')
      // Sin esto el navegador puede ignorar el content-type y adivinar otro:
      // la lista blanca no serviría de nada.
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=0, must-revalidate');
    /*
     * Un SVG es un documento, no solo una imagen: dentro de un `<img>` nunca
     * ejecuta scripts, pero abierto directo en una pestaña sí. `sandbox` lo
     * neutraliza sin estorbar el uso normal. No se aplica al PDF porque
     * deshabilita el visor integrado del navegador.
     */
    if (tipo === 'image/svg+xml') reply.header('content-security-policy', 'sandbox');
    return reply.send(createReadStream(path));
  });

  app.put('/api/fs/write', { config: { requires: 'fs:write' } }, async (req) => {
    const { path: raw, content } = req.body || {};
    const { path, root } = await guard.resolvePath(req.user, raw);
    if (typeof content !== 'string') {
      const err = new Error('Falta el contenido');
      err.statusCode = 400;
      throw err;
    }
    await hosts.get(root.host).writeFile(path, content);
    audit.log(req.user.id, 'fs.write', { path, bytes: Buffer.byteLength(content) }, req.ip);
    return { path, bytes: Buffer.byteLength(content) };
  });

  app.post('/api/fs/mkdir', { config: { requires: 'fs:write' } }, async (req) => {
    const nombre = req.body?.name;
    if (!nombreValido(nombre)) {
      const err = new Error('Nombre de carpeta inválido');
      err.statusCode = 400;
      throw err;
    }
    const dir = await destino(req.user, req.body?.dir);
    const to = join(dir.path, nombre);
    if (await dir.host.stat(to)) {
      const err = new Error(`Ya existe ${nombre} en esa carpeta`);
      err.statusCode = 409;
      throw err;
    }
    await dir.host.mkdir(to);
    audit.log(req.user.id, 'fs.mkdir', { path: to }, req.ip);
    return { path: to };
  });

  app.post('/api/fs/rename', { config: { requires: 'fs:write' } }, async (req) => {
    const from = await guard.resolvePath(req.user, req.body?.from, { mustExist: true });
    const to = await guard.resolvePath(req.user, req.body?.to);
    await hosts.get(from.root.host).rename(from.path, to.path);
    audit.log(req.user.id, 'fs.rename', { from: from.path, to: to.path }, req.ip);
    return { from: from.path, to: to.path };
  });

  /**
   * Copiar y mover toman el directorio destino, no la ruta final: el nombre
   * libre lo elige el agente. Es lo mismo que hace Finder al pegar dos veces.
   */
  app.post('/api/fs/copy', { config: { requires: 'fs:write' } }, async (req) => {
    const from = await guard.resolvePath(req.user, req.body?.from, { mustExist: true });
    const dir = await destino(req.user, req.body?.toDir);
    const nombre = await nombreLibre(dir.host, dir.path, basename(from.path));
    const to = join(dir.path, nombre);
    if (dir.path === from.path || dir.path.startsWith(from.path + '/')) {
      const err = new Error('No se puede copiar una carpeta dentro de sí misma');
      err.statusCode = 400;
      throw err;
    }
    await hosts.get(from.root.host).copy(from.path, to);
    audit.log(req.user.id, 'fs.copy', { from: from.path, to }, req.ip);
    return { path: to };
  });

  app.post('/api/fs/move', { config: { requires: 'fs:write' } }, async (req) => {
    const from = await guard.resolvePath(req.user, req.body?.from, { mustExist: true });
    const dir = await destino(req.user, req.body?.toDir);
    if (dir.path === from.path || dir.path.startsWith(from.path + '/')) {
      const err = new Error('No se puede mover una carpeta dentro de sí misma');
      err.statusCode = 400;
      throw err;
    }
    if (dirname(from.path) === dir.path) return { path: from.path };
    const nombre = await nombreLibre(dir.host, dir.path, basename(from.path));
    const to = join(dir.path, nombre);
    await hosts.get(from.root.host).rename(from.path, to);
    audit.log(req.user.id, 'fs.move', { from: from.path, to }, req.ip);
    return { path: to };
  });

  /**
   * Subir un archivo: el cuerpo son los bytes crudos y el destino va en la
   * query. Sin multipart —una dependencia más y un parser que mantener— para
   * algo que el navegador manda igual de bien con un `fetch` y un `File`.
   */
  app.post('/api/fs/upload', {
    config: { requires: 'fs:write' },
    bodyLimit: LIMITS.FILE_UPLOAD_MAX,
  }, async (req) => {
    const nombre = req.query.name;
    if (!nombreValido(nombre)) {
      const err = new Error('Nombre de archivo inválido');
      err.statusCode = 400;
      throw err;
    }
    const dir = await destino(req.user, req.query.dir);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const libre = await nombreLibre(dir.host, dir.path, nombre);
    const to = join(dir.path, libre);
    await dir.host.writeBytes(to, bytes);
    audit.log(req.user.id, 'fs.upload', { path: to, bytes: bytes.length }, req.ip);
    return { path: to, name: libre, bytes: bytes.length };
  });

  /** Crea un archivo vacío. Falla si ya existe: pisar en silencio sería peor. */
  app.post('/api/fs/create', { config: { requires: 'fs:write' } }, async (req) => {
    const nombre = req.body?.name;
    if (!nombreValido(nombre)) {
      const err = new Error('Nombre de archivo inválido');
      err.statusCode = 400;
      throw err;
    }
    const dir = await destino(req.user, req.body?.dir);
    const to = join(dir.path, nombre);
    if (await dir.host.stat(to)) {
      const err = new Error(`Ya existe ${nombre} en esa carpeta`);
      err.statusCode = 409;
      throw err;
    }
    await dir.host.writeFile(to, '');
    audit.log(req.user.id, 'fs.create', { path: to }, req.ip);
    return { path: to };
  });

  app.post('/api/fs/remove', { config: { requires: 'fs:write' } }, async (req) => {
    const { path, root } = await guard.resolvePath(req.user, req.body?.path, { mustExist: true });
    await hosts.get(root.host).remove(path, !!req.body?.recursive);
    audit.log(req.user.id, 'fs.remove', { path, recursive: !!req.body?.recursive }, req.ip);
    return { path };
  });
}
