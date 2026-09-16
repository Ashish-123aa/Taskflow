import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LoadingState } from './ui';

/**
 * Waits for the `GET /auth/me` check to resolve before deciding whether
 * to redirect — without this, a page refresh on a protected route would
 * flash to /login for a moment even for an already-logged-in user, since
 * `user` starts out null until that query resolves.
 */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Checking your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  return <Outlet />;
}

export function AdminRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingState label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  // Enforced on the backend too (authorize('ADMIN') — see docs/admin.md);
  // this redirect is purely a UX nicety so a non-admin doesn't land on a
  // page that will just show them a wall of 403s.
  if (user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}

export function GuestRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingState />;
  if (user) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
