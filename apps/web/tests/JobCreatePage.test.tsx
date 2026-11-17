import { render, screen, waitFor } from '@testing-library/react';
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
import { JobCreatePage } from '../src/pages/JobCreatePage';
import { createTestQueryClient, submitClosestForm } from './test-utils';

const mockedApi = vi.mocked(api, true);

function renderJobCreatePage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/jobs/create']}>
          <Routes>
            <Route path="/jobs/create" element={<JobCreatePage />} />
            <Route path="/jobs/:id" element={<p>Job details marker</p>} />
            <Route path="/jobs" element={<p>Jobs list marker</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('JobCreatePage', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the URL field for the default API_REQUEST type', () => {
    renderJobCreatePage();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
  });

  it('switches to email-specific fields when EMAIL is selected', async () => {
    const user = userEvent.setup();
    renderJobCreatePage();

    await user.selectOptions(screen.getByLabelText('Job type'), 'Email');

    expect(screen.getByLabelText('Recipient')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Body')).toBeInTheDocument();
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
  });

  it('switches to a file picker for CSV Processing', async () => {
    const user = userEvent.setup();
    const { container } = renderJobCreatePage();

    await user.selectOptions(screen.getByLabelText('Job type'), 'CSV Processing');

    expect(screen.getByText('CSV file')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('switches to a raw JSON textarea for Data Transformation', async () => {
    const user = userEvent.setup();
    renderJobCreatePage();

    await user.selectOptions(screen.getByLabelText('Job type'), 'Data Transformation');

    // The field's <label> also wraps a helper-text <span>, so its full
    // label text isn't exactly "Payload (JSON)" — hence `exact: false`.
    expect(screen.getByLabelText('Payload (JSON)', { exact: false })).toBeInTheDocument();
  });

  it('creates an API_REQUEST job with the right payload and navigates to its details page', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true, data: { id: 'job-1' } } });

    const user = userEvent.setup();
    renderJobCreatePage();

    await user.type(screen.getByLabelText('URL'), 'https://example.com/data');
    submitClosestForm(screen.getByRole('button', { name: 'Create job' }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/jobs', {
        name: 'API Request',
        priority: 'MEDIUM',
        type: 'API_REQUEST',
        payload: { url: 'https://example.com/data', method: 'GET' },
      });
    });
    expect(await screen.findByText('Job details marker')).toBeInTheDocument();
  });

  it('creates an EMAIL job with the recipient/subject/body payload', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true, data: { id: 'job-2' } } });

    const user = userEvent.setup();
    renderJobCreatePage();

    await user.selectOptions(screen.getByLabelText('Job type'), 'Email');
    await user.type(screen.getByLabelText('Recipient'), 'ada@example.com');
    await user.type(screen.getByLabelText('Subject'), 'Hello');
    await user.type(screen.getByLabelText('Body'), 'A message.');
    submitClosestForm(screen.getByRole('button', { name: 'Create job' }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/jobs',
        expect.objectContaining({
          type: 'EMAIL',
          payload: { to: 'ada@example.com', subject: 'Hello', body: 'A message.' },
        }),
      );
    });
  });

  it('uploads a CSV file via the dedicated upload endpoint', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true, data: { id: 'job-3' } } });

    const user = userEvent.setup();
    const { container } = renderJobCreatePage();

    await user.selectOptions(screen.getByLabelText('Job type'), 'CSV Processing');
    // The file input is a visually-hidden native <input type="file">
    // inside a styled drop-zone <label> nested within Field's own
    // <label> — a deliberate UI pattern (see JobCreatePage.tsx's
    // TypeSpecificFields), but the double label nesting means
    // getByLabelText can't resolve an accessible name for it. Querying
    // the input directly is the standard testing-library approach for
    // exactly this shape.
    const file = new File(['name,age\nAda,30'], 'people.csv', { type: 'text/csv' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    submitClosestForm(screen.getByRole('button', { name: 'Create job' }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/jobs/upload/csv',
        expect.any(FormData),
        expect.objectContaining({ headers: { 'Content-Type': 'multipart/form-data' } }),
      );
    });
    const [, formData] = mockedApi.post.mock.calls[0]!;
    expect((formData as FormData).get('file')).toBeInstanceOf(File);
  });

  it('shows an error and does not navigate when job creation fails', async () => {
    mockedApi.post.mockRejectedValue(new ApiRequestError({ success: false, message: 'Validation failed', errorCode: 'VALIDATION_ERROR' }, 400));

    const user = userEvent.setup();
    renderJobCreatePage();

    await user.type(screen.getByLabelText('URL'), 'https://example.com');
    submitClosestForm(screen.getByRole('button', { name: 'Create job' }));

    expect(await screen.findByText('Validation failed')).toBeInTheDocument();
    expect(screen.queryByText('Job details marker')).not.toBeInTheDocument();
  });
});
