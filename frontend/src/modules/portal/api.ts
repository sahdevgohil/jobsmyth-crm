import { useQuery } from '@tanstack/react-query';
import { portalFetch } from '@/services/portal-http';
import type { PortalAccount } from '@/stores/portal-auth-store';

export async function portalLoginRequest(
  email: string,
  password: string,
): Promise<{ data: { accessToken: string; account: PortalAccount } }> {
  return portalFetch('/portal/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function portalLogoutRequest(): Promise<void> {
  await portalFetch<void>('/portal/auth/logout', { method: 'POST' });
}

export async function portalMeRequest(): Promise<{ data: PortalAccount }> {
  return portalFetch('/portal/auth/me');
}

export async function portalChangePasswordRequest(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await portalFetch<void>('/portal/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

let inflightPortalBootstrap: Promise<string | null> | null = null;

/** Single-flight for the same reason as the staff bootstrap: rotated refresh tokens must not be replayed. */
export function bootstrapPortalSession(): Promise<string | null> {
  if (!inflightPortalBootstrap) {
    inflightPortalBootstrap = (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/portal/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data: { accessToken: string } };
        return json.data.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      inflightPortalBootstrap = null;
    });
  }
  return inflightPortalBootstrap;
}

export function usePortalProposals() {
  return useQuery({
    queryKey: ['portal', 'proposals'],
    queryFn: () => portalFetch<{ data: Array<Record<string, unknown>> }>('/portal/proposals'),
  });
}

export function usePortalProjects() {
  return useQuery({
    queryKey: ['portal', 'projects'],
    queryFn: () => portalFetch<{ data: Array<Record<string, unknown>> }>('/portal/projects'),
  });
}

export function usePortalInvoices() {
  return useQuery({
    queryKey: ['portal', 'invoices'],
    queryFn: () => portalFetch<{ data: Array<Record<string, unknown>> }>('/portal/invoices'),
  });
}

export function usePortalFiles() {
  return useQuery({
    queryKey: ['portal', 'files'],
    queryFn: () => portalFetch<{ data: Array<Record<string, unknown>> }>('/portal/files'),
  });
}
