import { describe, expect, it } from 'vitest';
import { PINO_HTTP_REDACT_PATHS } from './logging.js';

describe('logging redaction (V-05)', () => {
  it('redacts authorization and cookie headers', () => {
    expect(PINO_HTTP_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.set-cookie',
        'res.headers.set-cookie',
      ]),
    );
  });
});
