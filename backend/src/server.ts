import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { connectMongo } from './db/connection.js';
import { createLogger } from './utils/logger.js';

async function main(): Promise<void> {
  loadEnv();
  const logger = createLogger();
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
