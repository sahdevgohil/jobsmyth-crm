/** Paths redacted from structured HTTP logs (V-05 / CURSOR_RULES §13). */
export const PINO_HTTP_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.set-cookie',
  'res.headers.set-cookie',
] as const;
