import mongoose, { type ClientSession, type Types } from 'mongoose';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import {
  NotificationModel,
  type NotificationType,
} from './notification.model.js';

export type NotificationDto = {
  id: string;
  type: NotificationType;
  title: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

function toDto(doc: {
  _id: Types.ObjectId;
  type: string;
  title: string;
  link?: string | null;
  readAt?: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: doc._id.toString(),
    type: doc.type as NotificationType,
    title: doc.title,
    link: doc.link ?? null,
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function createNotification(
  input: {
    userId: Types.ObjectId | string;
    type: NotificationType;
    title: string;
    link?: string;
  },
  session?: ClientSession,
): Promise<void> {
  await NotificationModel.create(
    [
      {
        userId: input.userId,
        type: input.type,
        title: input.title,
        link: input.link,
      },
    ],
    { session: session ?? undefined },
  );
}

export async function listNotifications(input: {
  userId: string;
  page: number;
  pageSize: number;
  unreadOnly?: boolean;
}): Promise<{ data: NotificationDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const filter: Record<string, unknown> = { userId: input.userId };
  if (input.unreadOnly) {
    filter.readAt = null;
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    NotificationModel.countDocuments(filter),
    NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  return {
    data: rows.map(toDto),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return NotificationModel.countDocuments({ userId, readAt: null });
}

export async function markRead(input: {
  userId: string;
  id: string;
}): Promise<NotificationDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Notification not found.' });
  }
  const row = await NotificationModel.findOne({ _id: input.id, userId: input.userId });
  if (!row) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Notification not found.' });
  }
  if (!row.readAt) {
    row.readAt = new Date();
    await row.save();
  }
  return toDto(row);
}

export async function markAllRead(userId: string): Promise<{ updated: number }> {
  const result = await NotificationModel.updateMany(
    { userId, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}
