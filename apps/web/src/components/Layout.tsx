import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ListChecks,
  CalendarClock,
  Bell,
  UserCircle,
  ShieldCheck,
  Users,
  LogOut,
  Plus,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import type { ApiSuccess } from '../lib/types';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

const ADMIN_NAV_ITEMS = [
  { to: '/admin/jobs', label: 'All Jobs', icon: ShieldCheck },
  { to: '/admin/users', label: 'Users', icon: Users },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<unknown[]>>('/notifications', {
        params: { unreadOnly: true, limit: 1 },
      });
      return res.data.unreadCount ?? 0;
    },
    refetchInterval: 60_000,
  });

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 font-display text-sm font-bold text-white">
            T
          </div>
          <span className="font-display text-lg font-bold text-slate-900">TaskFlow</span>
        </div>

        <nav className="flex flex-col gap-0.5 p-3">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} {...item} onClick={() => setMobileOpen(false)} />
          ))}

          {user?.role === 'ADMIN' && (
            <>
              <div className="mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Admin
              </div>
              {ADMIN_NAV_ITEMS.map((item) => (
                <SidebarLink key={item.to} {...item} onClick={() => setMobileOpen(false)} />
              ))}
            </>
          )}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-100 p-3">
          <SidebarLink to="/profile" label="Profile" icon={UserCircle} onClick={() => setMobileOpen(false)} />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <LogOut size={17} />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <button
            type="button"
            className="text-slate-500 lg:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <div className="hidden lg:block" />

          <div className="flex items-center gap-3">
            <Link
              to="/jobs/create"
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Plus size={16} />
              New job
            </Link>

            <Link
              to="/notifications"
              className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Notifications"
            >
              <Bell size={19} />
              {Boolean(unreadQuery.data) && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
              )}
            </Link>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                {user?.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden text-sm font-medium text-slate-700 sm:block">{user?.name}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  onClick,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <Icon size={17} />
      {label}
    </NavLink>
  );
}
