import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export interface Pedido {
  titulo: string;
  mensaje?: string;
  /** Lo que aparece en el botón que confirma. */
  aceptar?: string;
  cancelar?: string;
  /** Acción irreversible: el botón se pinta en rojo y no toma el foco. */
  peligroso?: boolean;
  /** Sin cancelar: es solo un aviso. */
  soloAviso?: boolean;
  /** Texto adicional en monoespaciado, para rutas o comandos. */
  detalle?: string;
  /**
   * Convierte el diálogo en una pregunta con campo de texto.
   *
   * Un modal y no una fila editable dentro del árbol: en tablet la fila puede
   * quedar debajo del teclado virtual, y ahí no hay forma de ver lo que se
   * escribe. El modal se centra y el teclado no lo tapa.
   */
  entrada?: {
    valor?: string;
    marcador?: string;
    /** Selecciona solo el nombre, sin la extensión, como hace un explorador. */
    seleccionarBase?: boolean;
    /** Campo de varias líneas: para pegar un bloque, no un nombre. */
    multilinea?: boolean;
    /** Devolver el texto tal cual, sin recortar los extremos. */
    crudo?: boolean;
  };
}

/**
 * Diálogos propios en vez de `confirm()` y `alert()`.
 *
 * Los del navegador ignoran el tema, no se pueden redactar bien —el título es
 * la URL— y en iPad aparecen como una pieza del sistema en medio de la
 * aplicación. Además bloquean el hilo, así que nada se sigue pintando detrás.
 *
 * La interfaz es una promesa: `if (await dialogo.confirmar({...}))`, que se lee
 * igual que el `confirm` que reemplaza.
 */
export const useDialogo = defineStore('dialogo', () => {
  const abierto = ref(false);
  const pedido = shallowRef<Pedido | null>(null);
  /** Lo escrito en el campo, cuando el pedido trae `entrada`. */
  const texto = ref('');
  let resolver: ((v: boolean) => void) | null = null;

  function preguntar(p: Pedido): Promise<boolean> {
    // Si ya había uno abierto se cancela: dos diálogos apilados no se entienden.
    resolver?.(false);
    pedido.value = p;
    texto.value = p.entrada?.valor ?? '';
    abierto.value = true;
    return new Promise((res) => { resolver = res; });
  }

  function responder(v: boolean) {
    abierto.value = false;
    pedido.value = null;
    const r = resolver;
    resolver = null;
    r?.(v);
  }

  /**
   * Pide un texto. Devuelve lo escrito, o `null` si se canceló.
   *
   * Se devuelve `null` y no cadena vacía a propósito: cancelar y escribir nada
   * son cosas distintas, y quien llama casi siempre tiene que distinguirlas.
   */
  async function pedirTexto(p: Pedido & { entrada: NonNullable<Pedido['entrada']> }) {
    const ok = await preguntar(p);
    if (!ok) return null;
    // Al pegar un comando, los espacios y saltos son parte de lo pegado.
    if (p.entrada.crudo) return texto.value || null;
    const v = texto.value.trim();
    return v || null;
  }

  return {
    abierto,
    pedido,
    texto,
    responder,
    confirmar: (p: Pedido) => preguntar(p),
    avisar: (p: Pedido) => preguntar({ ...p, soloAviso: true }),
    pedirTexto,
  };
});
