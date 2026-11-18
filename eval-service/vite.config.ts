import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5280,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7280',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist-ui',
    emptyOutDir: true,
    target: 'esnext',
  },
});
