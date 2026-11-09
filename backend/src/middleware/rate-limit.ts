import rateLimit from 'express-rate-limit';

/**
 * Failed sign-in ceiling per 15 min. Defaults to 10. For LOCAL development only, set
 * AUTH_RATE_LIMIT_MAX in backend/.env (ignored when NODE_ENV=production).
 */
const override = Number(process.env.AUTH_RATE_LIMIT_MAX);
const authMax =
  process.env.NODE_ENV !== 'production' && Number.isInteger(override) && override > 0 ? override : 10;

/** Login / refresh: count failed attempts only (AC-AUTH-5). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    },
  },
});

/**
 * Forgot / reset / invite accept: count every request (V-03).
 * These endpoints often return 200 even when no email exists.
 */
export const authStrictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    },
  },
});

/** Paid Google requests (measurement runs, geocoding): per-user bucket in addition to the usage limits. */
export const solarRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as { auth?: { userId?: string } }).auth?.userId ?? req.ip ?? 'anon',
  validate: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many measurement requests. Please wait a minute and try again.' } },
});

/** Public website lead intake only (V2-11) — separate bucket from auth-strict routes. */
export const websiteLeadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many website lead submissions. Please try again later.',
    },
  },
});
