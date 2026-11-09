import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';
import { ChangePasswordPage } from './ChangePasswordPage';

const changePasswordRequest = vi.fn();
const meRequest = vi.fn();

vi.mock('@/modules/auth/api', () => ({
  changePasswordRequest: (...args: unknown[]) => changePasswordRequest(...args),
  meRequest: (...args: unknown[]) => meRequest(...args),
}));

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/app/change-password']}>
      <Routes>
        <Route path="/app/change-password" element={<ChangePasswordPage />} />
        <Route path="/app" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillPasswords(
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  confirm: string,
): Promise<void> {
  await user.type(screen.getByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password', { selector: 'input' }), next);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
}

describe('ChangePasswordPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    changePasswordRequest.mockReset();
    meRequest.mockReset();
    useAuthStore.setState({
      accessToken: 'token',
      bootstrapped: true,
      user: {
        id: '1',
        email: 'a@example.com',
        firstName: 'A',
        lastName: 'B',
        role: 'admin',
        mustChangePassword: true,
        permissions: [],
      },
    });
  });

  it('rejects password confirmation mismatch on the client', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillPasswords(user, 'LocalTempPass1!', 'LocalNewPass12!', 'DifferentPass12!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(changePasswordRequest).not.toHaveBeenCalled();
  });

  it('rejects short new passwords on the client', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillPasswords(user, 'LocalTempPass1!', 'short', 'short');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(changePasswordRequest).not.toHaveBeenCalled();
  });

  it('shows API error for incorrect current password', async () => {
    const user = userEvent.setup();
    changePasswordRequest.mockRejectedValue(
      new ApiError(400, { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' }),
    );
    renderPage();
    await fillPasswords(user, 'LocalTempPass1!', 'LocalNewPass12!', 'LocalNewPass12!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
  });

  it('refreshes user state and navigates to dashboard after success', async () => {
    const user = userEvent.setup();
    changePasswordRequest.mockResolvedValue(undefined);
    meRequest.mockResolvedValue({
      data: {
        id: '1',
        email: 'a@example.com',
        firstName: 'A',
        lastName: 'B',
        role: 'admin',
        mustChangePassword: false,
        permissions: [],
      },
    });
    renderPage();
    await fillPasswords(user, 'LocalTempPass1!', 'LocalNewPass12!', 'LocalNewPass12!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => {
      expect(useAuthStore.getState().user?.mustChangePassword).toBe(false);
    });
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });
});
