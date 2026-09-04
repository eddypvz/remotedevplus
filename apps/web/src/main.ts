import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles.css';
import App from './App.vue';
import { useSettings } from './stores/settings';

const app = createApp(App).use(createPinia());

// El tema ya lo aplicó el script inline de index.html; esto engancha el
// seguimiento en vivo de `prefers-color-scheme` para la opción "Sistema".
useSettings().init();

app.mount('#app');
