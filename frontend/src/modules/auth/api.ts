import { apiFetch } from '@/services/http';
import type { LoginResponse, MeResponse } from './types';

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutRequest(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

export async function meRequest(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me');
}

export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch<void>('/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function forgotPasswordRequest(email: string): Promise<{
  data: { message: string; emailDeliveryEnabled: boolean };
}> {
  return apiFetch('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPasswordRequest(token: string, newPassword: string): Promise<void> {
  await apiFetch<void>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function acceptInviteRequest(token: string, newPassword: string): Promise<void> {
  await apiFetch<void>('/auth/invites/accept', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

/** True when the last bootstrap failed because the server could not be reached (not because the session was rejected). */
export let lastBootstrapWasNetworkFailure = false;
let inflightBootstrap: Promise<string | null> | null = null;

/**
 * Restores a session from the refresh cookie. Refresh tokens rotate and a reused token revokes the whole
 * session family, so concurrent callers (React StrictMode runs effects twice in development) MUST share
 * a single in-flight request.
 */
export function bootstrapSession(): Promise<string | null> {
  if (!inflightBootstrap) {
    inflightBootstrap = (async () => {
      try {
        lastBootstrapWasNetworkFailure = false;
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data: { accessToken: string } };
        return json.data.accessToken;
      } catch {
        lastBootstrapWasNetworkFailure = true;
        return null;
      }
    })().finally(() => {
      inflightBootstrap = null;
    });
  }
  return inflightBootstrap;
}
