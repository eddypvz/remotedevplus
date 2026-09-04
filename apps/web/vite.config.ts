import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// El puerto sale de VITE_PORT a propósito: solo un frontend con Vite puede
// tener un puerto dado a la vez, y quién resuelve ese choque es el dev que
// clona, no remotedevplus.
const port = Number(process.env.VITE_PORT || 5173);
const agent = process.env.AGENT_URL || 'http://127.0.0.1:8790';

export default defineConfig({
  plugins: [vue()],
  server: {
    port,
    strictPort: true,   // fallar en vez de correrse a un puerto que el firewall no cubre
    host: true,         // se entra por dominio, no por localhost
    allowedHosts: true,
    proxy: {
      '/api': { target: agent, changeOrigin: false },
      '/ws': { target: agent, ws: true, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 700 },
});
