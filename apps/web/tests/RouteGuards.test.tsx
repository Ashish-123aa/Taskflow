import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api, ApiRequestError } from '../src/lib/api';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ProtectedRoute, AdminRoute, GuestRoute } from '../src/components/RouteGuards';
import { createTestQueryClient } from './test-utils';

const mockedApi = vi.mocked(api, true);

const unauthenticated = () =>
  mockedApi.get.mockRejectedValue(new ApiRequestError({ success: false, message: 'Auth required', errorCode: 'UNAUTHORIZED' }, 401));

const authenticatedAs = (role: 'USER' | 'ADMIN') =>
  mockedApi.get.mockResolvedValue({
    data: { success: true, data: { id: 'u1', name: 'Ada', email: 'ada@example.com', role, isActive: true, createdAt: '2026-01-01' } },
  });

function renderGuarded(guardElement: React.ReactElement, initialPath: string) {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={guardElement}>
              <Route path="/protected" element={<p>Protected content</p>} />
            </Route>
            <Route path="/login" element={<p>Login page</p>} />
            <Route path="/dashboard" element={<p>Dashboard page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a loading state while the session check is in flight', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));
    renderGuarded(<ProtectedRoute />, '/protected');
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
  });

  it('redirects to /login when there is no session', async () => {
    unauthenticated();
    renderGuarded(<ProtectedRoute />, '/protected');
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders the protected content once a session is confirmed', async () => {
    authenticatedAs('USER');
    renderGuarded(<ProtectedRoute />, '/protected');
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });
});

describe('AdminRoute', () => {
  afterEach(() => vi.clearAllMocks());

  it('redirects to /login when there is no session', async () => {
    unauthenticated();
    renderGuarded(<AdminRoute />, '/protected');
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('redirects a non-admin, authenticated user to /dashboard', async () => {
    authenticatedAs('USER');
    renderGuarded(<AdminRoute />, '/protected');
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders the protected content for an authenticated admin', async () => {
    authenticatedAs('ADMIN');
    renderGuarded(<AdminRoute />, '/protected');
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });
});

describe('GuestRoute', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the guest content (e.g. the login form) when there is no session', async () => {
    unauthenticated();
    renderGuarded(<GuestRoute />, '/protected');
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('redirects an already-authenticated user away to /dashboard', async () => {
    authenticatedAs('USER');
    renderGuarded(<GuestRoute />, '/protected');
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
});
