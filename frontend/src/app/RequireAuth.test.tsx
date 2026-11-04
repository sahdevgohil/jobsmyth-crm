import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import { RequireAuth } from './RequireAuth';

function renderWithAuth(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/app/change-password" element={<div>Change password page</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/app" element={<div>App home</div>} />
          <Route path="/app/users" element={<div>Users page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      bootstrapped: true,
    });
  });

  it('redirects unauthenticated users to login (AUTH-011)', () => {
    renderWithAuth('/app');
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('forces password change when mustChangePassword is true', () => {
    useAuthStore.getState().setSession('token', {
      id: '1',
      email: 'a@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'admin',
      mustChangePassword: true,
      permissions: ['users:manage'],
    });
    renderWithAuth('/app/users');
    expect(screen.getByText('Change password page')).toBeInTheDocument();
  });

  it('allows authenticated users without forced password change', () => {
    useAuthStore.getState().setSession('token', {
      id: '1',
      email: 'a@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'admin',
      mustChangePassword: false,
      permissions: ['users:manage'],
    });
    renderWithAuth('/app');
    expect(screen.getByText('App home')).toBeInTheDocument();
  });
});
