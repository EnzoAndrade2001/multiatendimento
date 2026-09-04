import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// O alvo acompanha o ambiente em execucao. Assim o demo isolado pode usar
// 3003 sem que o proxy tente atingir o banco/servidor local padrao em 3002.
const backendTarget = process.env.VITE_API_URL || 'http://localhost:3002';
const backendProxy = { target: backendTarget, changeOrigin: true };

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5174,
    proxy: {
      '/api': backendProxy,
      '/uploads': backendProxy,
      '/socket.io': { ...backendProxy, ws: true },
    },
  },
  preview: { port: 4174 },
});
