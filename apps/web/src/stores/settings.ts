import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = {
  theme: 'rdp.theme', font: 'rdp.term.font', keys: 'rdp.term.keys',
  enter: 'rdp.compose.enter',
};

/** En modo privado de Safari el acceso mismo puede lanzar, no solo devolver null. */
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* modo privado */ }
}

const media = matchMedia('(prefers-color-scheme: dark)');
const touch = matchMedia('(pointer: coarse)').matches;

export const useSettings = defineStore('settings', () => {
  const theme = ref<ThemePreference>((read(KEY.theme) as ThemePreference) || 'system');
  const systemDark = ref(media.matches);

  const resolvedTheme = computed<ResolvedTheme>(() => (
    theme.value === 'system' ? (systemDark.value ? 'dark' : 'light') : theme.value
  ));

  /**
   * Tamaño de letra del terminal Y de las conversaciones.
   *
   * Es uno solo a propósito: son las dos superficies donde se lee texto denso
   * durante horas, y tener dos controles para lo mismo obliga a acordarse de
   * ajustar los dos. Vive acá y no en el componente para que el cog pueda
   * tocarlo y todas las vistas abiertas cambien a la vez.
   */
  const fontSize = ref(Number(read(KEY.font)) || 13);
  const accessoryKeys = ref(touch || read(KEY.keys) === '1');

  /**
   * Enter envía el mensaje, o inserta un salto de línea.
   *
   * Envía por defecto en todos lados, incluida la tablet: es lo que la gente
   * espera de un campo de chat. Shift+Enter sigue insertando el salto, y quien
   * escriba párrafos largos puede invertirlo desde los ajustes.
   */
  const enterSends = ref(read(KEY.enter) === null ? true : read(KEY.enter) === '1');

  function setTheme(next: ThemePreference) { theme.value = next; }
  function setFontSize(next: number) {
    fontSize.value = Math.min(Math.max(Math.round(next), 9), 24);
  }
  function toggleAccessoryKeys() { accessoryKeys.value = !accessoryKeys.value; }
  function toggleEnterSends() { enterSends.value = !enterSends.value; }

  function apply() {
    document.documentElement.dataset.theme = resolvedTheme.value;
  }

  function init() {
    apply();
    // El sistema puede cambiar de tema mientras la app está abierta (modo noche
    // programado de iPadOS, por ejemplo). Con 'system' hay que seguirlo en vivo.
    media.addEventListener('change', (e) => { systemDark.value = e.matches; });
  }

  watch(resolvedTheme, apply);
  watch(theme, (v) => write(KEY.theme, v));
  watch(fontSize, (v) => write(KEY.font, String(v)));
  watch(accessoryKeys, (v) => write(KEY.keys, v ? '1' : '0'));
  watch(enterSends, (v) => write(KEY.enter, v ? '1' : '0'));

  return {
    theme, resolvedTheme, fontSize, accessoryKeys, enterSends, isTouch: touch,
    setTheme, setFontSize, toggleAccessoryKeys, toggleEnterSends, init,
  };
});
