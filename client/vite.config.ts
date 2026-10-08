import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Forward WebSocket traffic to the game server during development.
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
