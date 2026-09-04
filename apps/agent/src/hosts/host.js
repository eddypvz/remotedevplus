/**
 * Un Host es una máquina donde se puede leer archivos, buscar y lanzar
 * procesos. En fase 1 solo existe LocalHost, pero ningún servicio toca el
 * filesystem directo: todos van por esta interfaz.
 *
 * Es la costura para multi-host. Cuando entre SshHost (arrancar el bundle del
 * agente en otra máquina y tunelear hacia allá, que es lo que hace VS Code
 * Remote-SSH), no hay que reescribir fs, pty, search ni git.
 *
 * @typedef {object} Host
 * @property {string} id
 * @property {string} label
 * @property {(p: string) => Promise<string>} realpath
 * @property {(p: string) => Promise<object|null>} stat
 * @property {(p: string) => Promise<object[]>} list
 * @property {(p: string) => Promise<{content: string, encoding: string, size: number}>} readFile
 * @property {(p: string, content: string) => Promise<void>} writeFile
 * @property {(p: string) => Promise<void>} mkdir
 * @property {(from: string, to: string) => Promise<void>} copy
 * @property {(p: string, buf: Buffer) => Promise<void>} writeBytes
 * @property {(p: string, recursive: boolean) => Promise<void>} remove
 * @property {(from: string, to: string) => Promise<void>} rename
 * @property {(dir: string, onChange: () => void) => (() => void)} watch
 * @property {(opts: object) => object} spawnPty
 * @property {(cmd: string, args: string[], opts?: object) => Promise<{code: number, stdout: string, stderr: string}>} exec
 */
export {};
