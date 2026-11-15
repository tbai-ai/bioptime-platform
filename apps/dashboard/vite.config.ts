import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the API under /dashboard in production; in development Vite proxies /api to the API on :3000.
export default defineConfig({
  base: '/portal/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
  // no source maps in the build: the API serves dist under /portal/ to anyone, and a .map would publish the whole source
  build: { outDir: 'dist', sourcemap: false, emptyOutDir: true },
});
