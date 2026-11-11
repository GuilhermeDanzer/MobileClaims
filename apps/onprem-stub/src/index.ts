import { buildServer } from './server';

const app = buildServer();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
