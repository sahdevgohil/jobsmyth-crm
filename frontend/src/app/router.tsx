import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { AuditPage } from '@/pages/AuditPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { LookupsPage } from '@/pages/LookupsPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/UsersPage';
import { RequireAuth } from './RequireAuth';
import { RequirePermission } from './RequirePermission';
import { SessionBootstrap } from './SessionBootstrap';

export function AppRouter(): React.ReactElement {
  return (
    <BrowserRouter>
      <SessionBootstrap>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="change-password" element={<ChangePasswordPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route element={<RequirePermission permission="users:manage" />}>
                <Route path="users" element={<UsersPage />} />
              </Route>
              <Route element={<RequirePermission permission="settings:update" />}>
                <Route path="lookups" element={<LookupsPage />} />
              </Route>
              <Route element={<RequirePermission permission="audit:read" />}>
                <Route path="audit" element={<AuditPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </SessionBootstrap>
    </BrowserRouter>
  );
}
