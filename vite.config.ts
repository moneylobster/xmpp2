import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Use the self-contained UMD/IIFE build that doesn't have dynamic imports
      // Use the headless-only UMD build — no UI plugins, no ChatRoomView errors
      'converse.js': resolve(__dirname, 'node_modules/converse.js/src/headless/dist/converse-headless.js'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
