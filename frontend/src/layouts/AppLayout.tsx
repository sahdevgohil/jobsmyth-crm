import { Bell, ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/shared/BrandLogo';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';
import { GlobalSearch } from '@/components/shared/GlobalSearch';
import { SyncBadge } from '@/components/shared/SyncBadge';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { cn } from '@/lib/cn';
import { logoutRequest } from '@/modules/auth/api';
import { useMarkAllNotificationsRead, useNotifications, useUnreadCount } from '@/modules/notifications/api';
import { forgetRememberedProfile, useAuthStore } from '@/stores/auth-store';
import { NAV_GROUPS } from './navigation';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('sidebar-collapsed') === '1';
  } catch {
    return false;
  }
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }): React.ReactElement {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return (
    <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.permission || permissions.includes(i.permission));
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-2 mb-1 border-t border-border" />
            ) : (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted',
                        isActive && 'bg-brand-soft text-brand before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-brand',
                        collapsed && 'justify-center px-2',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }): React.ReactElement {
  return (
    <Link to="/app" aria-label="Legacy Construction Group LLC — dashboard" className="flex items-center justify-center border-b border-border px-3 py-3">
      {collapsed ? <BrandLogo variant="mark" height={36} /> : <BrandLogo height={84} />}
    </Link>
  );
}

function NotificationMenu(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword === true);
  const { data: unread } = useUnreadCount({ enabled: !mustChange });
  const list = useNotifications();
  const markAll = useMarkAllNotificationsRead();
  const count = unread?.data.count ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {count > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{count > 9 ? '9+' : count}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {count > 0 ? (
              <button type="button" className="text-xs text-brand hover:underline" onClick={() => markAll.mutate()}>
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-auto">
            {(list.data?.data ?? []).length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">You are all caught up.</li>
            ) : (
              (list.data?.data ?? []).map((n) => (
                <li key={n.id} className={cn('px-3 py-2 text-sm', !n.readAt && 'bg-secondary/60')}>
                  {n.link ? (
                    <Link to={n.link} onClick={() => setOpen(false)} className="text-foreground hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                  <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ProfileMenu(): React.ReactElement | null {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  if (!user) return null;
  async function onLogout(): Promise<void> {
    try {
      await logoutRequest();
    } finally {
      forgetRememberedProfile();
      clearSession();
      void navigate('/login');
    }
  }
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
      >
        <UserAvatar first={user.firstName} last={user.lastName} />
        <span className="hidden whitespace-nowrap text-left leading-tight md:block">
          <span className="block text-sm font-medium">{user.firstName} {user.lastName}</span>
          <span className="block text-xs capitalize text-muted-foreground">{user.role}</span>
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-border bg-card py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium">{user.firstName} {user.lastName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Link to="/app/change-password" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent">
            <KeyRound className="h-4 w-4" aria-hidden /> Change password
          </Link>
          <button type="button" onClick={() => void onLogout()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-accent">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppLayout(): React.ReactElement {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  function toggleCollapsed(): void {
    setCollapsed((c) => {
      try {
        localStorage.setItem('sidebar-collapsed', c ? '0' : '1');
      } catch {
        /* storage unavailable: preference simply isn't remembered */
      }
      return !c;
    });
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-11 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card">
            <div className="flex items-center justify-between border-b border-border">
              <Brand collapsed={false} />
              <button type="button" aria-label="Close menu" className="mr-2 p-2 text-foreground" onClick={() => setDrawer(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <button type="button" aria-label="Open menu" className="rounded-md p-2 hover:bg-accent lg:hidden" onClick={() => setDrawer(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 flex-1 sm:block">
            <Breadcrumbs />
          </div>
          <div className="ml-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <GlobalSearch />
            <SyncBadge />
            <NotificationMenu />
            <ProfileMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
