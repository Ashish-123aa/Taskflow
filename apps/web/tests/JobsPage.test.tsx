import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api, ApiRequestError } from '../src/lib/api';
import { ToastProvider } from '../src/contexts/ToastContext';
import { JobsPage } from '../src/pages/JobsPage';
import { createTestQueryClient } from './test-utils';

const mockedApi = vi.mocked(api, true);

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', userId: 'u1', type: 'API_REQUEST', name: 'Fetch weather', status: 'QUEUED', priority: 'MEDIUM',
    payload: {}, result: null, error: null, progress: 0, attempts: 0, maxAttempts: 3,
    scheduledAt: null, startedAt: null, completedAt: null, failedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderJobsPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <JobsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockJobsResponse(jobs: ReturnType<typeof makeJob>[], pagination = { page: 1, limit: 20, total: jobs.length, totalPages: 1 }) {
  mockedApi.get.mockResolvedValue({ data: { success: true, data: jobs, pagination } });
}

describe('JobsPage', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a loading state before jobs arrive', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));
    renderJobsPage();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows an error state on failure', async () => {
    mockedApi.get.mockRejectedValue(new ApiRequestError({ success: false, message: 'Could not load jobs', errorCode: 'INTERNAL_SERVER_ERROR' }, 500));
    renderJobsPage();
    expect(await screen.findByText('Could not load jobs')).toBeInTheDocument();
  });

  it('shows an empty state when there are no jobs', async () => {
    mockJobsResponse([]);
    renderJobsPage();
    expect(await screen.findByText('No jobs found')).toBeInTheDocument();
  });

  it('renders a row per job with its name, type, and status', async () => {
    mockJobsResponse([
      makeJob({ id: 'job-1', name: 'Fetch weather', status: 'COMPLETED' }),
      makeJob({ id: 'job-2', name: 'Send receipt', type: 'EMAIL', status: 'FAILED' }),
    ]);
    renderJobsPage();

    expect(await screen.findByText('Fetch weather')).toBeInTheDocument();
    expect(screen.getByText('Send receipt')).toBeInTheDocument();
    // "API Request"/"Email" also appear as <option> text in the type
    // filter dropdown, so these two are scoped to the table specifically.
    const table = screen.getByRole('table');
    expect(within(table).getByText('API Request')).toBeInTheDocument();
    expect(within(table).getByText('Email')).toBeInTheDocument();
    expect(within(table).getByText('Completed')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
  });

  it('filters the visible rows by name via the client-side search box', async () => {
    mockJobsResponse([makeJob({ id: 'job-1', name: 'Fetch weather' }), makeJob({ id: 'job-2', name: 'Send receipt' })]);
    const user = userEvent.setup();
    renderJobsPage();

    await screen.findByText('Fetch weather');
    await user.type(screen.getByPlaceholderText('Search by name…'), 'weather');

    expect(screen.getByText('Fetch weather')).toBeInTheDocument();
    expect(screen.queryByText('Send receipt')).not.toBeInTheDocument();
  });

  it('only shows Cancel for a cancellable job (QUEUED) and Retry for a retryable one (FAILED)', async () => {
    mockJobsResponse([
      makeJob({ id: 'job-1', name: 'Queued job', status: 'QUEUED' }),
      makeJob({ id: 'job-2', name: 'Failed job', status: 'FAILED' }),
      makeJob({ id: 'job-3', name: 'Completed job', status: 'COMPLETED' }),
    ]);
    renderJobsPage();
    await screen.findByText('Queued job');

    expect(screen.getAllByLabelText('Cancel')).toHaveLength(1);
    expect(screen.getAllByLabelText('Retry')).toHaveLength(1);
    // COMPLETED and FAILED are both deletable, QUEUED is not
    expect(screen.getAllByLabelText('Delete')).toHaveLength(2);
  });

  it('cancels a job after confirming the dialog', async () => {
    mockJobsResponse([makeJob({ id: 'job-1', name: 'Queued job', status: 'QUEUED' })]);
    mockedApi.post.mockResolvedValue({ data: { success: true } });

    const user = userEvent.setup();
    renderJobsPage();
    await screen.findByText('Queued job');

    await user.click(screen.getByLabelText('Cancel'));
    expect(screen.getByText('Cancel this job?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel job' }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/jobs/job-1/cancel');
    });
  });

  it('does not show pagination controls when there is only one page', async () => {
    mockJobsResponse([makeJob()], { page: 1, limit: 20, total: 1, totalPages: 1 });
    renderJobsPage();
    await screen.findByText('Fetch weather');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('shows pagination controls across multiple pages, with Previous disabled on page 1', async () => {
    mockJobsResponse([makeJob()], { page: 1, limit: 20, total: 40, totalPages: 2 });
    renderJobsPage();

    expect(await screen.findByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
