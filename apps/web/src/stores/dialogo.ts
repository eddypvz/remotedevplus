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
  let resolver: ((v: boolean) => void) | null = null;

  function preguntar(p: Pedido): Promise<boolean> {
    // Si ya había uno abierto se cancela: dos diálogos apilados no se entienden.
    resolver?.(false);
    pedido.value = p;
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

  return {
    abierto,
    pedido,
    responder,
    confirmar: (p: Pedido) => preguntar(p),
    avisar: (p: Pedido) => preguntar({ ...p, soloAviso: true }),
  };
});
