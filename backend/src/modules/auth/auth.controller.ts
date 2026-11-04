import type { CookieOptions, Request, Response } from 'express';
import { getEnv, getCorsOrigins } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { getValidatedBody } from '../../middleware/validate.js';
import { AppError } from '../../utils/errors.js';
import * as authService from './auth.service.js';
import type {
  acceptInviteBodySchema,
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
} from './auth.validation.js';
import type { z } from 'zod';

function cookieOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: authService.REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

function clearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: authService.REFRESH_COOKIE_PATH,
  };
}

function sessionMeta(req: Request): authService.SessionMeta {
  return {
    userAgent: req.header('user-agent') ?? undefined,
    ip: req.ip,
    requestId: req.requestId,
  };
}

function assertRefreshOrigin(req: Request): void {
  const origin = req.header('origin');
  if (!origin) {
    return;
  }
  if (!getCorsOrigins().includes(origin)) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Origin not allowed.',
    });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof loginBodySchema>>(req);
  const result = await authService.login(body.email, body.password, sessionMeta(req));
  res.cookie(authService.REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions());
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
    },
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  assertRefreshOrigin(req);
  const raw = req.cookies?.[authService.REFRESH_COOKIE_NAME] as string | undefined;
  const result = await authService.refresh(raw, sessionMeta(req));
  res.cookie(authService.REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions());
  res.status(200).json({ data: { accessToken: result.accessToken } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.[authService.REFRESH_COOKIE_NAME] as string | undefined;
  await authService.logout(raw, sessionMeta(req), req.auth?.userId);
  res.clearCookie(authService.REFRESH_COOKIE_NAME, clearCookieOptions());
  res.status(204).send();
}

export async function me(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const user = await authService.getMe(auth.userId);
  res.status(200).json({ data: user });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof changePasswordBodySchema>>(req);
  const raw = req.cookies?.[authService.REFRESH_COOKIE_NAME] as string | undefined;
  const keepHash = raw
    ? (await import('../../utils/crypto.js')).hashToken(raw)
    : undefined;
  await authService.changePassword(
    auth.userId,
    body.currentPassword,
    body.newPassword,
    sessionMeta(req),
    keepHash,
  );
  res.status(204).send();
}

/**
 * AUTH-008: never reveals whether the email exists.
 * Email delivery is disabled until INT-03 (Resend) is validated.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof forgotPasswordBodySchema>>(req);
  await authService.createPasswordResetToken(body.email);
  res.status(200).json({
    data: {
      message:
        'If an account exists for that email, password reset instructions will be sent when email delivery is configured.',
      emailDeliveryEnabled: false,
    },
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof resetPasswordBodySchema>>(req);
  await authService.resetPasswordWithToken(body.token, body.newPassword, sessionMeta(req));
  res.status(204).send();
}

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof acceptInviteBodySchema>>(req);
  await authService.acceptInvite(body.token, body.newPassword, sessionMeta(req));
  res.status(204).send();
}
