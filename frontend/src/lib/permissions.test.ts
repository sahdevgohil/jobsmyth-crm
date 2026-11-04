import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import { useHasPermission } from './permissions';

describe('useHasPermission', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
  });

  it('returns false when no user is signed in', () => {
    const { result } = renderHook(() => useHasPermission('users:manage'));
    expect(result.current).toBe(false);
  });

  it('returns true when the permission is present', () => {
    useAuthStore.getState().setSession('token', {
      id: '1',
      email: 'a@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'admin',
      mustChangePassword: false,
      permissions: ['users:manage', 'settings:read'],
    });
    const { result } = renderHook(() => useHasPermission('users:manage'));
    expect(result.current).toBe(true);
    const missing = renderHook(() => useHasPermission('audit:read'));
    expect(missing.result.current).toBe(false);
  });
});
