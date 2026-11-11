import { loadConfig } from './config';
import { buildServer } from './server';

const config = loadConfig();
const app = await buildServer(config);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
