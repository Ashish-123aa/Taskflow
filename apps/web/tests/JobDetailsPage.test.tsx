import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { api, ApiRequestError } from '../src/lib/api';
import { ToastProvider } from '../src/contexts/ToastContext';
import { JobDetailsPage } from '../src/pages/JobDetailsPage';
import { createTestQueryClient } from './test-utils';

const mockedApi = vi.mocked(api, true);

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', userId: 'u1', type: 'API_REQUEST', name: 'Fetch weather', status: 'QUEUED', priority: 'HIGH',
    payload: { url: 'https://example.com' }, result: null, error: null, progress: 0, attempts: 1, maxAttempts: 3,
    scheduledAt: null, startedAt: null, completedAt: null, failedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockJob(overrides: Record<string, unknown> = {}) {
  mockedApi.get.mockResolvedValue({ data: { success: true, data: makeJob(overrides) } });
}

function renderJobDetails() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/jobs/job-1']}>
          <Routes>
            <Route path="/jobs/:id" element={<JobDetailsPage />} />
            <Route path="/jobs" element={<p>Jobs list marker</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('JobDetailsPage', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a loading state before the job arrives', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));
    renderJobDetails();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows an error state when the job cannot be loaded', async () => {
    mockedApi.get.mockRejectedValue(new ApiRequestError({ success: false, message: 'Job not found', errorCode: 'JOB_NOT_FOUND' }, 404));
    renderJobDetails();
    expect(await screen.findByText('Job not found')).toBeInTheDocument();
  });

  it('requests the job identified by the URL', async () => {
    mockJob();
    renderJobDetails();
    await screen.findByRole('heading', { name: 'Fetch weather' });
    expect(mockedApi.get).toHaveBeenCalledWith('/jobs/job-1');
  });

  it('renders the job overview: name, type, attempts, and ID', async () => {
    mockJob({ attempts: 2, maxAttempts: 5 });
    renderJobDetails();

    expect(await screen.findByRole('heading', { name: 'Fetch weather' })).toBeInTheDocument();
    expect(screen.getByText('API Request')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText('job-1')).toBeInTheDocument();
  });

  describe('state-dependent actions', () => {
    it('a QUEUED job can be cancelled but not retried', async () => {
      mockJob({ status: 'QUEUED' });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.getByRole('button', { name: 'Cancel job' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('a FAILED job can be retried but not cancelled', async () => {
      mockJob({ status: 'FAILED', error: 'ECONNREFUSED' });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel job' })).not.toBeInTheDocument();
    });

    it('a DEAD_LETTER job can be retried', async () => {
      mockJob({ status: 'DEAD_LETTER' });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('a COMPLETED job offers neither cancel nor retry', async () => {
      mockJob({ status: 'COMPLETED' });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.queryByRole('button', { name: 'Cancel job' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('a RUNNING job offers neither cancel nor retry (cancelling a running job is not supported)', async () => {
      mockJob({ status: 'RUNNING', progress: 45 });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.queryByRole('button', { name: 'Cancel job' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('cancels the job only after confirming the dialog', async () => {
      mockJob({ status: 'QUEUED' });
      mockedApi.post.mockResolvedValue({ data: { success: true } });

      const user = userEvent.setup();
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      await user.click(screen.getByRole('button', { name: 'Cancel job' }));
      expect(screen.getByText('Cancel this job?')).toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled(); // opening the dialog alone must not cancel anything

      // The dialog's confirm button shares the "Cancel job" label with the
      // page's own button; the dialog renders last in the DOM.
      const cancelButtons = screen.getAllByRole('button', { name: 'Cancel job' });
      await user.click(cancelButtons[cancelButtons.length - 1]!);

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/jobs/job-1/cancel'));
    });

    it('dismissing the cancel dialog does not cancel the job', async () => {
      mockJob({ status: 'QUEUED' });

      const user = userEvent.setup();
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      await user.click(screen.getByRole('button', { name: 'Cancel job' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByText('Cancel this job?')).not.toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it('retries a failed job', async () => {
      mockJob({ status: 'FAILED' });
      mockedApi.post.mockResolvedValue({ data: { success: true } });

      const user = userEvent.setup();
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/jobs/job-1/retry'));
    });

    it('surfaces the server error when a retry is rejected', async () => {
      mockJob({ status: 'FAILED' });
      mockedApi.post.mockRejectedValue(
        new ApiRequestError({ success: false, message: 'Cannot retry a job with status RUNNING', errorCode: 'CONFLICT' }, 409),
      );

      const user = userEvent.setup();
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Cannot retry a job with status RUNNING')).toBeInTheDocument();
    });
  });

  describe('job state display', () => {
    it('shows the error message of a failed job', async () => {
      mockJob({ status: 'FAILED', error: 'ECONNREFUSED 10.0.0.1:443' });
      renderJobDetails();

      expect(await screen.findByText('ECONNREFUSED 10.0.0.1:443')).toBeInTheDocument();
    });

    it('shows a progress bar with the percentage only while RUNNING', async () => {
      mockJob({ status: 'RUNNING', progress: 45 });
      renderJobDetails();

      expect(await screen.findByText('45%')).toBeInTheDocument();
      expect(screen.getByText('Progress')).toBeInTheDocument();
    });

    it('does not show a progress bar for a finished job', async () => {
      mockJob({ status: 'COMPLETED', progress: 100 });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    });

    it('offers a download link only when the result has a generated file', async () => {
      mockJob({ status: 'COMPLETED', result: { reportFile: 'generated/report-job-1.csv' } });
      renderJobDetails();

      const link = await screen.findByRole('link', { name: /Download result/ });
      expect(link).toHaveAttribute('href', '/api/v1/jobs/job-1/download');
    });

    it('offers no download link for a result without a generated file', async () => {
      mockJob({ status: 'COMPLETED', result: { statusCode: 200 } });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.queryByRole('link', { name: /Download result/ })).not.toBeInTheDocument();
    });

    it('labels the last timeline step "Failed" for a failed job and "Completed" otherwise', async () => {
      mockJob({ status: 'FAILED' });
      const { unmount } = renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      let timeline = within(screen.getByText('Execution timeline').closest('div') as HTMLElement);
      expect(timeline.getByText('Failed')).toBeInTheDocument();
      expect(timeline.queryByText('Completed')).not.toBeInTheDocument();
      unmount();

      mockJob({ status: 'COMPLETED' });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      timeline = within(screen.getByText('Execution timeline').closest('div') as HTMLElement);
      expect(timeline.getByText('Completed')).toBeInTheDocument();
      expect(timeline.queryByText('Failed')).not.toBeInTheDocument();
    });

    it('lists every attempt with its error', async () => {
      mockJob({
        status: 'DEAD_LETTER',
        jobAttempts: [
          { id: 'a1', jobId: 'job-1', attemptNumber: 1, status: 'FAILED', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z', error: 'timeout', duration: 1000 },
          { id: 'a2', jobId: 'job-1', attemptNumber: 2, status: 'FAILED', startedAt: '2026-01-01T00:00:05Z', completedAt: '2026-01-01T00:00:06Z', error: 'connection reset', duration: 1000 },
        ],
      });
      renderJobDetails();

      expect(await screen.findByText('Attempt 1')).toBeInTheDocument();
      expect(screen.getByText('Attempt 2')).toBeInTheDocument();
      expect(screen.getByText('timeout')).toBeInTheDocument();
      expect(screen.getByText('connection reset')).toBeInTheDocument();
    });

    it('omits the attempts card entirely when there are no attempts', async () => {
      mockJob({ status: 'QUEUED', jobAttempts: [] });
      renderJobDetails();
      await screen.findByRole('heading', { name: 'Fetch weather' });

      expect(screen.queryByRole('heading', { name: 'Attempts' })).not.toBeInTheDocument();
    });
  });
});
