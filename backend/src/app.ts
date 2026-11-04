import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getCorsOrigins, getEnv } from './config/env.js';
import { PINO_HTTP_REDACT_PATHS } from './config/logging.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { usersRouter } from './modules/users/user.routes.js';
import { createLogger } from './utils/logger.js';

export function createApp() {
  const env = getEnv();
  const app = express();
  const logger = createLogger();

  app.set('trust proxy', 1);
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      customProps: (req: Request) => ({ requestId: req.requestId }),
      autoLogging: env.NODE_ENV !== 'test',
      redact: {
        paths: [...PINO_HTTP_REDACT_PATHS],
        remove: true,
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: getCorsOrigins(),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.status(200).json({ data: { status: 'ok' } });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/audit-logs', auditRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
      },
    });
  });

  app.use(errorHandler);
  return app;
}
