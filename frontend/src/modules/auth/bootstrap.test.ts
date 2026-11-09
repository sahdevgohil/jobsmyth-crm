import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSession } from './api';

describe('bootstrapSession', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shares one refresh request between concurrent callers (rotating tokens must not be replayed)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { accessToken: 'tok' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([bootstrapSession(), bootstrapSession()]);
    expect(a).toBe('tok');
    expect(b).toBe('tok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when there is no valid session, and allows a later retry', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await bootstrapSession()).toBeNull();
    expect(await bootstrapSession()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
