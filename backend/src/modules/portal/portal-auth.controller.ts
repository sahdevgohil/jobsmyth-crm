import type { CookieOptions, Request, Response } from 'express';
import type { z } from 'zod';
import { getCorsOrigins, getEnv } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePortal } from '../../middleware/portal-authenticate.js';
import { getValidatedBody } from '../../middleware/validate.js';
import { AppError } from '../../utils/errors.js';
import { hashToken } from '../../utils/crypto.js';
import * as portalAuth from './portal-auth.service.js';
import type {
  createPortalAccountBodySchema,
  portalChangePasswordBodySchema,
  portalForgotPasswordBodySchema,
  portalLoginBodySchema,
  portalResetPasswordBodySchema,
} from './portal.validation.js';

function cookieOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: portalAuth.PORTAL_REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

function clearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: portalAuth.PORTAL_REFRESH_COOKIE_PATH,
  };
}

function sessionMeta(req: Request): portalAuth.SessionMeta {
  return {
    userAgent: req.header('user-agent') ?? undefined,
    ip: req.ip,
    requestId: req.requestId,
  };
}

function assertRefreshOrigin(req: Request): void {
  const origin = req.header('origin');
  if (!origin) return;
  if (!getCorsOrigins().includes(origin)) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Origin not allowed.',
    });
  }
}

export async function createAccount(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof createPortalAccountBodySchema>>(req);
  const result = await portalAuth.createCustomerAccount({
    customerId: body.customerId,
    email: body.email,
    password: body.temporaryPassword,
    firstName: body.firstName,
    lastName: body.lastName,
    actorUserId: auth.userId,
    actorRole: auth.role,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({
    data: {
      account: result.account,
      temporaryPasswordSet: result.temporaryPasswordSet,
    },
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof portalLoginBodySchema>>(req);
  const result = await portalAuth.login(body.email, body.password, sessionMeta(req));
  res.cookie(portalAuth.PORTAL_REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions());
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      account: result.account,
    },
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  assertRefreshOrigin(req);
  const raw = req.cookies?.[portalAuth.PORTAL_REFRESH_COOKIE_NAME] as string | undefined;
  const result = await portalAuth.refresh(raw, sessionMeta(req));
  res.cookie(portalAuth.PORTAL_REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions());
  res.status(200).json({ data: { accessToken: result.accessToken } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.[portalAuth.PORTAL_REFRESH_COOKIE_NAME] as string | undefined;
  await portalAuth.logout(raw, sessionMeta(req), req.portal?.accountId);
  res.clearCookie(portalAuth.PORTAL_REFRESH_COOKIE_NAME, clearCookieOptions());
  res.status(204).send();
}

export async function me(req: Request, res: Response): Promise<void> {
  const portal = requirePortal(req);
  const account = await portalAuth.getMe(portal.accountId);
  res.status(200).json({ data: account });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const portal = requirePortal(req);
  const body = getValidatedBody<z.infer<typeof portalChangePasswordBodySchema>>(req);
  const raw = req.cookies?.[portalAuth.PORTAL_REFRESH_COOKIE_NAME] as string | undefined;
  const keepHash = raw ? hashToken(raw) : undefined;
  await portalAuth.changePassword(
    portal.accountId,
    body.currentPassword,
    body.newPassword,
    sessionMeta(req),
    keepHash,
  );
  res.status(204).send();
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof portalForgotPasswordBodySchema>>(req);
  await portalAuth.createPasswordResetToken(body.email);
  res.status(200).json({
    data: {
      message: 'If an account exists for that email, reset instructions will be sent.',
      emailDeliveryEnabled: false,
    },
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof portalResetPasswordBodySchema>>(req);
  await portalAuth.resetPasswordWithToken(body.token, body.newPassword, sessionMeta(req));
  res.status(204).send();
}
