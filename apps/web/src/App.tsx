import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/Layout';
import { AdminRoute, GuestRoute, ProtectedRoute } from './components/RouteGuards';
import { LoadingState } from './components/ui';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailsPage } from './pages/JobDetailsPage';
import { JobCreatePage } from './pages/JobCreatePage';
import { SchedulesPage } from './pages/SchedulesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';

/**
 * Most routes load eagerly — this is a dashboard, not a marketing site,
 * so the common path (log in, see your jobs) shouldn't wait on extra
 * network round-trips. The two pages split out below are the two biggest
 * contributors to bundle size for reasons unrelated to how often they're
 * visited: the dashboard pulls in the entire Recharts library, and the
 * admin pages are, by definition, only ever loaded by a fraction of
 * users. Splitting just these two keeps the main bundle meaningfully
 * smaller without scattering Suspense boundaries through every route.
 */
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const AdminJobsPage = lazy(() =>
  import('./pages/AdminJobsPage').then((m) => ({ default: m.AdminJobsPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<LoadingState />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/create" element={<JobCreatePage />} />
            <Route path="/jobs/:id" element={<JobDetailsPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/profile" element={<ProfilePage />} />

            <Route element={<AdminRoute />}>
              <Route
                path="/admin/jobs"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <AdminJobsPage />
                  </Suspense>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <AdminUsersPage />
                  </Suspense>
                }
              />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
