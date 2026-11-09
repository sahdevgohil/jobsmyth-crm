import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { connectMongo } from './db/connection.js';
import { createLogger } from './utils/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger();
  logger.info({ googleSolarKeyConfigured: Boolean(env.GOOGLE_SOLAR_API_KEY) }, 'Google Solar API key');
  await connectMongo();
  const app = createApp();
  const port = Number(process.env.PORT ?? 4000);

  const server = app.listen(port, () => {
    logger.info({ port }, 'API listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void import('./db/connection.js').then(({ disconnectMongo }) =>
        disconnectMongo().finally(() => process.exit(0)),
      );
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
