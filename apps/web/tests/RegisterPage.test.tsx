import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api, ApiRequestError } from '../src/lib/api';
import { AuthProvider } from '../src/contexts/AuthContext';
import { RegisterPage } from '../src/pages/RegisterPage';
import { createTestQueryClient, submitClosestForm } from './test-utils';

const mockedApi = vi.mocked(api, true);

function renderRegisterPage() {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={<p>Dashboard marker</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('RegisterPage', () => {
  beforeEach(() => {
    mockedApi.get.mockRejectedValue(new ApiRequestError({ success: false, message: 'Auth required', errorCode: 'UNAUTHORIZED' }, 401));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The Password field's <label> also contains a helper-text <span>
  // ("At least 8 characters, ..."), so its full label text isn't
  // exactly "Password" — hence `exact: false` on that one query.
  const passwordField = () => screen.getByLabelText('Password', { exact: false });

  it('renders the registration form', async () => {
    renderRegisterPage();
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(passwordField()).toBeInTheDocument();
  });

  it('rejects a weak password client-side, before ever calling the API', async () => {
    const user = userEvent.setup();
    renderRegisterPage();

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(passwordField(), 'weak');
    submitClosestForm(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('rejects a name under 2 characters', async () => {
    const user = userEvent.setup();
    renderRegisterPage();

    await user.type(screen.getByLabelText('Name'), 'A');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(passwordField(), 'Password123');
    submitClosestForm(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument();
  });

  it('registers with valid input and navigates to the dashboard', async () => {
    mockedApi.post.mockResolvedValue({
      data: { success: true, data: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'USER', isActive: true, createdAt: '2026-01-01' } },
    });

    const user = userEvent.setup();
    renderRegisterPage();

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(passwordField(), 'Password123');
    submitClosestForm(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/register', { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Password123' });
    });
    expect(await screen.findByText('Dashboard marker')).toBeInTheDocument();
  });

  it('shows a server-side duplicate-email error without navigating', async () => {
    mockedApi.post.mockRejectedValue(new ApiRequestError({ success: false, message: 'An account with this email already exists', errorCode: 'CONFLICT' }, 409));

    const user = userEvent.setup();
    renderRegisterPage();

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(passwordField(), 'Password123');
    submitClosestForm(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard marker')).not.toBeInTheDocument();
  });
});
