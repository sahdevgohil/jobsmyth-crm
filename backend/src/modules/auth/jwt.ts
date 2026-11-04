import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '../../config/env.js';
import type { Role } from '../../config/permissions.js';
import { AppError } from '../../utils/errors.js';

const ACCESS_TTL = '15m';
const AUDIENCE_INTERNAL = 'internal';

export type AccessTokenClaims = {
  sub: string;
  aud: typeof AUDIENCE_INTERNAL;
  role: Role;
  iat: number;
  exp: number;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signAccessToken(input: {
  userId: string;
  role: Role;
}): Promise<string> {
  return new SignJWT({ role: input.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setAudience(AUDIENCE_INTERNAL)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      audience: AUDIENCE_INTERNAL,
    });
    if (
      typeof payload.sub !== 'string' ||
      payload.aud !== AUDIENCE_INTERNAL ||
      (payload.role !== 'admin' && payload.role !== 'salesperson')
    ) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Invalid access token.',
      });
    }
    return {
      sub: payload.sub,
      aud: AUDIENCE_INTERNAL,
      role: payload.role,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'ERR_JWT_EXPIRED'
        ? 'TOKEN_EXPIRED'
        : 'UNAUTHORIZED';
    throw new AppError({
      status: 401,
      code,
      message: code === 'TOKEN_EXPIRED' ? 'Access token expired.' : 'Invalid access token.',
      cause: error,
    });
  }
}
