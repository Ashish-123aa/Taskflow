import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

// jsdom has no ResizeObserver, which recharts' ResponsiveContainer
// requires to measure its container — mocking the library is the
// standard approach for testing a page's own logic (loading/error/data
// states, what numbers get shown) without needing real chart rendering,
// which SVG-dimension assertions wouldn't meaningfully verify anyway.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { api, ApiRequestError } from '../src/lib/api';
import { DashboardPage } from '../src/pages/DashboardPage';
import { createTestQueryClient } from './test-utils';

const mockedApi = vi.mocked(api, true);

const SAMPLE_STATS = {
  totalJobs: 42,
  completedJobs: 30,
  runningJobs: 2,
  failedJobs: 5,
  queuedJobs: 5,
  successRate: 85.7,
  avgProcessingTimeMs: 4200,
  jobsByType: [{ type: 'API_REQUEST', count: 20 }, { type: 'EMAIL', count: 22 }],
  jobsByStatus: [{ status: 'COMPLETED', count: 30 }, { status: 'FAILED', count: 5 }],
  jobsOverTime: [{ date: '2026-01-01', total: 3, completed: 2, failed: 1 }],
};

function renderDashboard() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  // DashboardPage's own markup includes SVG-only elements (<defs>,
  // <linearGradient>, <stop>) as children of <AreaChart>. With the chart
  // library mocked as plain <div>s, React/jsdom warn that those tags are
  // "unrecognized in this browser" — expected, harmless fallout of the
  // mock, and noisy enough to bury a real failure in CI output. Only
  // that specific family of warnings is filtered; every other
  // console.error still passes through untouched.
  const originalConsoleError = console.error;
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = String(args[0] ?? '');
      if (/is unrecognized in this browser|incorrect casing|React does not recognize/.test(message)) return;
      originalConsoleError(...args);
    });
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => vi.clearAllMocks());

  it('shows a loading state before data arrives', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText('Loading your dashboard…')).toBeInTheDocument();
  });

  it('shows an error state with a retry button on failure', async () => {
    mockedApi.get.mockRejectedValue(new ApiRequestError({ success: false, message: 'Could not load stats', errorCode: 'INTERNAL_SERVER_ERROR' }, 500));
    renderDashboard();

    expect(await screen.findByText('Could not load stats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders the headline stats once data loads', async () => {
    mockedApi.get.mockResolvedValue({ data: { success: true, data: SAMPLE_STATS } });
    renderDashboard();

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('85.7%')).toBeInTheDocument();
    expect(screen.getByText('Total jobs')).toBeInTheDocument();
    expect(screen.getByText('Success rate')).toBeInTheDocument();
  });

  it('retries the query when "Try again" is clicked', async () => {
    mockedApi.get.mockRejectedValueOnce(new ApiRequestError({ success: false, message: 'Network error', errorCode: 'INTERNAL_SERVER_ERROR' }, 500));
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: SAMPLE_STATS } });

    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('Network error');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('42')).toBeInTheDocument();
  });
});
