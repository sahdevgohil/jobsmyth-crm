import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import { getEnv } from '../../config/env.js';
import { recordAudit } from '../../services/audit.js';
import { generateOpaqueToken, hashToken } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';
import { AuthTokenModel } from '../auth/auth-token.model.js';
import { signPortalAccessToken } from '../auth/jwt.js';
import { RefreshSessionModel } from '../auth/refresh-session.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { CustomerAccountModel } from './customer-account.model.js';

export const PORTAL_REFRESH_COOKIE_NAME = 'portalRefreshToken';
export const PORTAL_REFRESH_COOKIE_PATH = '/api/v1/portal/auth';

export type SessionMeta = {
  userAgent?: string;
  ip?: string;
  requestId?: string;
};

export type PortalAccountDto = {
  id: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
};

function toDto(account: {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
}): PortalAccountDto {
  return {
    id: account._id.toString(),
    customerId: account.customerId.toString(),
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    mustChangePassword: account.mustChangePassword,
  };
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function refreshExpiryDate(): Date {
  const days = getEnv().REFRESH_TOKEN_TTL_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createRefreshSession(
  accountId: Types.ObjectId,
  meta: SessionMeta,
  familyId = randomUUID(),
): Promise<string> {
  const refreshToken = generateOpaqueToken();
  await RefreshSessionModel.create({
    principalType: 'customer',
    principalId: accountId,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshExpiryDate(),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return refreshToken;
}

async function revokeFamily(familyId: string): Promise<void> {
  await RefreshSessionModel.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllPortalSessions(accountId: string): Promise<void> {
  await RefreshSessionModel.updateMany(
    {
      principalType: 'customer',
      principalId: accountId,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
  );
}

export async function createCustomerAccount(input: {
  customerId: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  actorUserId: string;
  actorRole: 'admin' | 'salesperson';
  requestId?: string;
  ip?: string;
}): Promise<{ account: PortalAccountDto; temporaryPasswordSet: true }> {
  const filter: Record<string, unknown> = { _id: input.customerId };
  if (input.actorRole !== 'admin') filter.ownerId = input.actorUserId;
  const customer = await CustomerModel.findOne(filter);
  if (!customer) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  const email = input.email.toLowerCase().trim();
  const existing = await CustomerAccountModel.findOne({
    $or: [{ customerId: input.customerId }, { email }],
  });
  if (existing) {
    throw new AppError({
      status: 409,
      code: 'CONFLICT',
      message: 'A portal account already exists for this customer or email.',
    });
  }

  const account = await CustomerAccountModel.create({
    customerId: input.customerId,
    email,
    passwordHash: await hashPassword(input.password),
    firstName: input.firstName ?? customer.firstName ?? 'Customer',
    lastName: input.lastName ?? customer.lastName ?? 'Portal',
    isActive: true,
    mustChangePassword: true,
  });

  await recordAudit({
    actorType: 'user',
    actorId: input.actorUserId,
    action: 'portal.account_created',
    entityType: 'customerAccount',
    entityId: account._id.toString(),
    changes: { customerId: input.customerId, email },
    requestId: input.requestId,
    ip: input.ip,
  });

  return { account: toDto(account), temporaryPasswordSet: true };
}

export async function login(
  email: string,
  password: string,
  meta: SessionMeta,
): Promise<{ accessToken: string; refreshToken: string; account: PortalAccountDto }> {
  const account = await CustomerAccountModel.findOne({
    email: email.toLowerCase().trim(),
  });
  if (!account || !account.isActive) {
    throw new AppError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
    });
  }
  const valid = await verifyPassword(account.passwordHash, password);
  if (!valid) {
    throw new AppError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
    });
  }

  const accessToken = await signPortalAccessToken({
    accountId: account._id.toString(),
    customerId: account.customerId.toString(),
  });
  const refreshToken = await createRefreshSession(account._id, meta);
  account.lastLoginAt = new Date();
  await account.save();

  await recordAudit({
    actorType: 'customer',
    actorId: account._id,
    action: 'portal.login_succeeded',
    entityType: 'customerAccount',
    entityId: account._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });

  return { accessToken, refreshToken, account: toDto(account) };
}

export async function refresh(
  rawRefreshToken: string | undefined,
  meta: SessionMeta,
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!rawRefreshToken) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Refresh token required.',
    });
  }

  const tokenHash = hashToken(rawRefreshToken);
  const now = new Date();
  const claimed = await RefreshSessionModel.findOneAndUpdate(
    {
      tokenHash,
      principalType: 'customer',
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { revokedAt: now } },
    { new: false },
  );

  if (!claimed) {
    const existing = await RefreshSessionModel.findOne({ tokenHash, principalType: 'customer' });
    if (!existing) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Invalid refresh session.',
      });
    }
    if (existing.revokedAt) {
      await revokeFamily(existing.familyId);
      throw new AppError({
        status: 401,
        code: 'SESSION_REVOKED',
        message: 'Session revoked due to refresh token reuse.',
      });
    }
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Refresh session expired.',
    });
  }

  const account = await CustomerAccountModel.findById(claimed.principalId);
  if (!account || !account.isActive) {
    await revokeFamily(claimed.familyId);
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Account is inactive.',
    });
  }

  const newRefreshToken = generateOpaqueToken();
  try {
    const newSession = await RefreshSessionModel.create({
      principalType: 'customer',
      principalId: account._id,
      tokenHash: hashToken(newRefreshToken),
      familyId: claimed.familyId,
      expiresAt: refreshExpiryDate(),
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    await RefreshSessionModel.updateOne(
      { _id: claimed._id },
      { $set: { replacedBy: newSession._id } },
    );
    const accessToken = await signPortalAccessToken({
      accountId: account._id.toString(),
      customerId: account.customerId.toString(),
    });
    return { accessToken, refreshToken: newRefreshToken };
  } catch (error) {
    await revokeFamily(claimed.familyId);
    throw error;
  }
}

export async function logout(
  rawRefreshToken: string | undefined,
  meta: SessionMeta,
  accountId?: string,
): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  const session = await RefreshSessionModel.findOne({
    tokenHash,
    principalType: 'customer',
  });
  if (session && !session.revokedAt) {
    session.revokedAt = new Date();
    await session.save();
    await recordAudit({
      actorType: accountId ? 'customer' : 'system',
      actorId: accountId,
      action: 'portal.logout',
      entityType: 'customerAccount',
      entityId: session.principalId.toString(),
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }
}

export async function getMe(accountId: string): Promise<PortalAccountDto> {
  const account = await CustomerAccountModel.findById(accountId);
  if (!account || !account.isActive) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return toDto(account);
}

export async function changePassword(
  accountId: string,
  currentPassword: string,
  newPassword: string,
  meta: SessionMeta,
  keepSessionTokenHash?: string,
): Promise<void> {
  const account = await CustomerAccountModel.findById(accountId);
  if (!account || !account.isActive) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  const valid = await verifyPassword(account.passwordHash, currentPassword);
  if (!valid) {
    throw new AppError({
      status: 400,
      code: 'INVALID_PASSWORD',
      message: 'Current password is incorrect.',
    });
  }
  account.passwordHash = await hashPassword(newPassword);
  account.mustChangePassword = false;
  await account.save();

  const filter: Record<string, unknown> = {
    principalType: 'customer',
    principalId: account._id,
    revokedAt: { $exists: false },
  };
  if (keepSessionTokenHash) {
    filter.tokenHash = { $ne: keepSessionTokenHash };
  }
  await RefreshSessionModel.updateMany(filter, { $set: { revokedAt: new Date() } });

  await recordAudit({
    actorType: 'customer',
    actorId: account._id,
    action: 'portal.password_changed',
    entityType: 'customerAccount',
    entityId: account._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });
}

export async function createPasswordResetToken(
  email: string,
): Promise<{ created: boolean; token?: string }> {
  const account = await CustomerAccountModel.findOne({
    email: email.toLowerCase().trim(),
    isActive: true,
  });
  if (!account) {
    return { created: false };
  }
  const token = generateOpaqueToken();
  await AuthTokenModel.create({
    purpose: 'password_reset',
    principalType: 'customer',
    principalId: account._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { created: true, token };
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  meta: SessionMeta,
): Promise<void> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const authToken = await AuthTokenModel.findOneAndUpdate(
    {
      tokenHash,
      purpose: 'password_reset',
      principalType: 'customer',
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } },
    { new: false },
  );
  if (!authToken) {
    throw new AppError({
      status: 400,
      code: 'INVALID_TOKEN',
      message: 'Reset token is invalid or expired.',
    });
  }
  const account = await CustomerAccountModel.findById(authToken.principalId);
  if (!account || !account.isActive) {
    throw new AppError({
      status: 400,
      code: 'INVALID_TOKEN',
      message: 'Reset token is invalid or expired.',
    });
  }
  account.passwordHash = await hashPassword(newPassword);
  account.mustChangePassword = false;
  await account.save();
  await revokeAllPortalSessions(account._id.toString());

  await recordAudit({
    actorType: 'customer',
    actorId: account._id,
    action: 'portal.password_reset',
    entityType: 'customerAccount',
    entityId: account._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });
}
