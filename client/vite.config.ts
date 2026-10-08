import { defineConfig } from 'vite';

export default defineConfig({
  // three.js and the physics engine (with its WebAssembly inlined) are big by nature.
  build: { chunkSizeWarningLimit: 6000 },
  server: {
    // Forward WebSocket traffic to the game server during development.
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
