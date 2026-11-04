import { useAuthStore } from '@/stores/auth-store';

export function useHasPermission(permission: string): boolean {
  return useAuthStore((s) => s.user?.permissions.includes(permission) ?? false);
}
