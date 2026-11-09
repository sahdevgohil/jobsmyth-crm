import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getCorsOrigins, getEnv } from './config/env.js';
import { PINO_HTTP_REDACT_PATHS } from './config/logging.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { activitiesRouter } from './modules/activities/activity.routes.js';
import { afterSalesRouter } from './modules/after-sales/after-sales.routes.js';
import { appointmentsRouter } from './modules/appointments/appointment.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { communicationsRouter } from './modules/communications/communication.routes.js';
import { customersRouter, propertiesRouter } from './modules/customers/customer.routes.js';
import { estimatesRouter } from './modules/estimates/estimate.routes.js';
import { filesRouter } from './modules/files/file.routes.js';
import { inspectionsRouter } from './modules/inspections/inspection.routes.js';
import { pricingRouter } from './modules/pricing/pricing.routes.js';
import { formsRouter } from './modules/forms/form.routes.js';
import { invoicesRouter, paymentsRouter } from './modules/invoices/invoice.routes.js';
import { integrationsRouter } from './modules/integrations/integration.routes.js';
import { leadsRouter, publicWebsiteLeadsRouter } from './modules/leads/lead.routes.js';
import { materialsRouter, materialRequirementsRouter } from './modules/materials/material.routes.js';
import { measurementsRouter } from './modules/measurements/measurement.routes.js';
import { notificationsRouter } from './modules/notifications/notification.routes.js';
import {
  portalAccountsRouter,
  portalAuthRouter,
  portalDataRouter,
} from './modules/portal/portal.routes.js';
import { stormRouter } from './modules/storm/storm.routes.js';
import { pipelineRouter } from './modules/pipeline/pipeline.routes.js';
import { projectsRouter, tasksRouter } from './modules/projects/project.routes.js';
import { proposalsRouter } from './modules/proposals/proposal.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { subcontractorsRouter } from './modules/subcontractors/subcontractor.routes.js';
import { usersRouter } from './modules/users/user.routes.js';
import { workOrdersRouter } from './modules/work-orders/work-order.routes.js';
import { createLogger } from './utils/logger.js';

const FILES_BASE_PATH = '/api/v1/files';

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
      // Lets the browser read the address-based report file name.
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  // The files router parses its own (larger, base64-sized) JSON bodies after authentication.
  const defaultJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => {
    if (req.path === FILES_BASE_PATH || req.path.startsWith(`${FILES_BASE_PATH}/`)) {
      next();
      return;
    }
    defaultJson(req, res, next);
  });
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.status(200).json({ data: { status: 'ok' } });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/audit-logs', auditRouter);
  app.use('/api/v1/leads', leadsRouter);
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/properties', propertiesRouter);
  app.use('/api/v1/activities', activitiesRouter);
  app.use('/api/v1/appointments', appointmentsRouter);
  app.use('/api/v1/inspections', inspectionsRouter);
  app.use('/api/v1/measurements', measurementsRouter);
  app.use('/api/v1/estimates', estimatesRouter);
  app.use('/api/v1/materials', materialsRouter);
  app.use('/api/v1/material-requirements', materialRequirementsRouter);
  app.use('/api/v1/proposals', proposalsRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/pipeline', pipelineRouter);
  app.use('/api/v1/storm', stormRouter);
  app.use('/api/v1/subcontractors', subcontractorsRouter);
  app.use('/api/v1/work-orders', workOrdersRouter);
  app.use('/api/v1/forms', formsRouter);
  app.use('/api/v1/pricing', pricingRouter);
  app.use('/api/v1/invoices', invoicesRouter);
  app.use('/api/v1/payments', paymentsRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/integrations', integrationsRouter);
  app.use('/api/v1/search', searchRouter);
  app.use(FILES_BASE_PATH, filesRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  app.use('/api/v1/communications', communicationsRouter);
  app.use('/api/v1/after-sales', afterSalesRouter);
  app.use('/api/v1/portal/auth', portalAuthRouter);
  app.use('/api/v1/portal/accounts', portalAccountsRouter);
  app.use('/api/v1/portal', portalDataRouter);
  app.use('/api/v1/public/website-leads', publicWebsiteLeadsRouter);

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
