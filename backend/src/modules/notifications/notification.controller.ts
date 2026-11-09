import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import { getValidatedParams, getValidatedQuery } from '../../middleware/validate.js';
import * as notificationService from './notification.service.js';
import type {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from './notification.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const query = getValidatedQuery<z.infer<typeof listNotificationsQuerySchema>>(req);
  const result = await notificationService.listNotifications({
    userId: auth.userId,
    page: query.page,
    pageSize: query.pageSize,
    unreadOnly: query.unreadOnly,
  });
  res.status(200).json(result);
}

export async function unread(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const count = await notificationService.unreadCount(auth.userId);
  res.status(200).json({ data: { count } });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = getValidatedParams<z.infer<typeof notificationIdParamsSchema>>(req);
  const data = await notificationService.markRead({ userId: auth.userId, id: params.id });
  res.status(200).json({ data });
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const data = await notificationService.markAllRead(auth.userId);
  res.status(200).json({ data });
}
