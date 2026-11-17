import { Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api, ApiRequestError } from '../src/lib/api';
import { AuthProvider } from '../src/contexts/AuthContext';
import { LoginPage } from '../src/pages/LoginPage';
import { createTestQueryClient, submitClosestForm } from './test-utils';

const mockedApi = vi.mocked(api, true);

function renderLoginPage() {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<p>Dashboard marker</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockedApi.get.mockRejectedValue(new ApiRequestError({ success: false, message: 'Auth required', errorCode: 'UNAUTHORIZED' }, 401));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form', async () => {
    renderLoginPage();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows client-side validation errors and never calls the API for an invalid submission', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    submitClosestForm(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('logs in with valid credentials and navigates to the dashboard', async () => {
    mockedApi.post.mockResolvedValue({
      data: { success: true, data: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'USER', isActive: true, createdAt: '2026-01-01' } },
    });

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123');
    submitClosestForm(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', { email: 'ada@example.com', password: 'Password123' });
    });
    expect(await screen.findByText('Dashboard marker')).toBeInTheDocument();
  });

  it('shows the server error message on invalid credentials and stays on the page', async () => {
    mockedApi.post.mockRejectedValue(new ApiRequestError({ success: false, message: 'Invalid email or password', errorCode: 'UNAUTHORIZED' }, 401));

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'WrongPassword');
    submitClosestForm(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard marker')).not.toBeInTheDocument();
  });
});
