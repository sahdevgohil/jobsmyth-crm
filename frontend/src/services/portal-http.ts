import { ApiError, type ApiErrorBody } from '@/types/api';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

const API_URL = import.meta.env.VITE_API_URL as string;

let refreshPromise: Promise<string | null> | null = null;

async function refreshPortalAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${API_URL}/portal/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        usePortalAuthStore.getState().clearSession();
        return null;
      }
      const json = (await res.json()) as { data: { accessToken: string } };
      usePortalAuthStore.getState().setAccessToken(json.data.accessToken);
      return json.data.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function portalFetch<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = usePortalAuthStore.getState().accessToken;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && retry && !path.startsWith('/portal/auth/login')) {
    const newToken = await refreshPortalAccessToken();
    if (newToken) {
      return portalFetch<T>(path, options, false);
    }
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      401,
      body?.error ?? { code: 'UNAUTHORIZED', message: 'Session expired. Please sign in again.' },
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = json as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error ?? { code: 'UNKNOWN', message: 'Request failed.' },
    );
  }
  return json as T;
}
