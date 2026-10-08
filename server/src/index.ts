import { fileURLToPath } from 'node:url';
import { createGameServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);
const staticDir = fileURLToPath(new URL('../../client/dist', import.meta.url));

const server = createGameServer({ staticDir });
server.http.listen(port, () => {
  console.log(`tengame server listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close().then(() => process.exit(0)));
}
