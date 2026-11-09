import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import { getEnv } from '../../config/env.js';
import { recordAudit } from '../../services/audit.js';
import { generateOpaqueToken, hashToken } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';
import { toPublicUserDto } from '../users/user.mapper.js';
import { UserModel, type UserDocument } from '../users/user.model.js';
import type { PublicUserDto } from '../users/user.types.js';
import { AuthTokenModel } from './auth-token.model.js';
import { signAccessToken } from './jwt.js';
import { RefreshSessionModel } from './refresh-session.model.js';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

export { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH };

export type SessionMeta = {
  userAgent?: string;
  ip?: string;
  requestId?: string;
};

export type AuthTokensResult = {
  accessToken: string;
  refreshToken: string;
  user: PublicUserDto;
};

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function createPasswordHash(password: string): Promise<string> {
  return hashPassword(password);
}

function refreshExpiryDate(): Date {
  const days = getEnv().REFRESH_TOKEN_TTL_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createRefreshSession(
  userId: Types.ObjectId,
  meta: SessionMeta,
  familyId = randomUUID(),
): Promise<string> {
  const refreshToken = generateOpaqueToken();
  await RefreshSessionModel.create({
    principalType: 'user',
    principalId: userId,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshExpiryDate(),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return refreshToken;
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await RefreshSessionModel.updateMany(
    { principalId: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export async function login(
  email: string,
  password: string,
  meta: SessionMeta,
): Promise<AuthTokensResult> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.isActive) {
    await recordAudit({
      actorType: 'system',
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: email,
      changes: { reason: 'invalid_credentials_or_inactive' },
      requestId: meta.requestId,
      ip: meta.ip,
    });
    throw new AppError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
    });
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await recordAudit({
      actorType: 'user',
      actorId: user._id,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user._id.toString(),
      changes: { reason: 'invalid_password' },
      requestId: meta.requestId,
      ip: meta.ip,
    });
    throw new AppError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
    });
  }

  const accessToken = await signAccessToken({
    userId: user._id.toString(),
    role: user.role,
  });
  const refreshToken = await createRefreshSession(user._id, meta);

  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    actorType: 'user',
    actorId: user._id,
    action: 'auth.login_succeeded',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });

  return {
    accessToken,
    refreshToken,
    user: toPublicUserDto(user),
  };
}

async function revokeFamily(familyId: string): Promise<void> {
  await RefreshSessionModel.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
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

  // V-01: atomically claim the session so concurrent refresh cannot fork the family.
  const claimed = await RefreshSessionModel.findOneAndUpdate(
    {
      tokenHash,
      principalType: 'user',
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { revokedAt: now } },
    { new: false },
  );

  if (!claimed) {
    const existing = await RefreshSessionModel.findOne({ tokenHash });
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

  const user = await UserModel.findById(claimed.principalId);
  if (!user || !user.isActive) {
    await revokeFamily(claimed.familyId);
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'User is inactive.',
    });
  }

  const newRefreshToken = generateOpaqueToken();
  try {
    const newSession = await RefreshSessionModel.create({
      principalType: 'user',
      principalId: user._id,
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

    const accessToken = await signAccessToken({
      userId: user._id.toString(),
      role: user.role,
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
  actorId?: string,
): Promise<void> {
  if (!rawRefreshToken) {
    return;
  }
  const tokenHash = hashToken(rawRefreshToken);
  const session = await RefreshSessionModel.findOne({ tokenHash });
  if (session && !session.revokedAt) {
    session.revokedAt = new Date();
    await session.save();
    await recordAudit({
      actorType: actorId ? 'user' : 'system',
      actorId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: session.principalId.toString(),
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }
}

export async function getMe(userId: string): Promise<PublicUserDto> {
  const user = await UserModel.findById(userId);
  if (!user || !user.isActive) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return toPublicUserDto(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta: SessionMeta,
  keepSessionTokenHash?: string,
): Promise<void> {
  const user = await UserModel.findById(userId);
  if (!user || !user.isActive) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw new AppError({
      status: 400,
      code: 'INVALID_PASSWORD',
      message: 'Current password is incorrect.',
    });
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();

  const filter: Record<string, unknown> = {
    principalId: user._id,
    revokedAt: { $exists: false },
  };
  if (keepSessionTokenHash) {
    filter.tokenHash = { $ne: keepSessionTokenHash };
  }
  await RefreshSessionModel.updateMany(filter, { $set: { revokedAt: new Date() } });

  await recordAudit({
    actorType: 'user',
    actorId: user._id,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });
}

/**
 * AUTH-008 boundary: creates a reset token but does not send email until INT-03.
 * Always returns the same public response shape; never reveals whether the email exists.
 * Returns the raw token only for Admin/temp flows and tests — never expose in API responses.
 */
export async function createPasswordResetToken(
  email: string,
): Promise<{ created: boolean; token?: string }> {
  const user = await UserModel.findOne({
    email: email.toLowerCase().trim(),
    isActive: true,
  });
  if (!user) {
    return { created: false };
  }

  const token = generateOpaqueToken();
  await AuthTokenModel.create({
    purpose: 'password_reset',
    principalType: 'user',
    principalId: user._id,
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

  const user = await UserModel.findById(authToken.principalId);
  if (!user || !user.isActive) {
    throw new AppError({
      status: 400,
      code: 'INVALID_TOKEN',
      message: 'Reset token is invalid or expired.',
    });
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
  await revokeAllUserSessions(user._id.toString());

  await recordAudit({
    actorType: 'user',
    actorId: user._id,
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });
}

export async function createInviteToken(userId: Types.ObjectId): Promise<string> {
  const token = generateOpaqueToken();
  await AuthTokenModel.create({
    purpose: 'invite',
    principalType: 'user',
    principalId: userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  });
  return token;
}

export async function acceptInvite(
  token: string,
  newPassword: string,
  meta: SessionMeta,
): Promise<void> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const authToken = await AuthTokenModel.findOneAndUpdate(
    {
      tokenHash,
      purpose: 'invite',
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
      message: 'Invite token is invalid or expired.',
    });
  }

  const user = await UserModel.findById(authToken.principalId);
  if (!user || !user.isActive) {
    throw new AppError({
      status: 400,
      code: 'INVALID_TOKEN',
      message: 'Invite token is invalid or expired.',
    });
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
  // V-04: revoke any sessions created with the temporary password before invite accept.
  await revokeAllUserSessions(user._id.toString());

  await recordAudit({
    actorType: 'user',
    actorId: user._id,
    action: 'auth.invite_accepted',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  });
}

export function assertUserDocument(user: UserDocument | null): asserts user is UserDocument {
  if (!user) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'User not found.',
    });
  }
}
