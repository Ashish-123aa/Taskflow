import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '../lib/api';
import type { ApiSuccess, Job, Pagination } from '../lib/types';
import { JOB_PRIORITIES, JOB_STATUSES, JOB_TYPES, JOB_TYPE_LABELS } from '../lib/constants';
import { formatDate, formatDurationFromDates } from '../lib/format';
import { Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

const CANCELLABLE = new Set(['PENDING', 'QUEUED']);
const RETRYABLE = new Set(['FAILED', 'DEAD_LETTER']);
const DELETABLE = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER']);

export function JobsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<{ job: Job; action: 'cancel' | 'delete' } | null>(
    null,
  );

  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const jobsQuery = useQuery({
    queryKey: ['jobs', { page, status, type, priority }],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<Job[]>>('/jobs', {
        params: { page, limit: 20, status: status || undefined, type: type || undefined, priority: priority || undefined },
      });
      return { jobs: res.data.data, pagination: res.data.pagination as Pagination };
    },
    placeholderData: (previous) => previous,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Job cancelled', 'success');
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not cancel job', 'error'),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Job re-queued', 'success');
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not retry job', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Job deleted', 'success');
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not delete job', 'error'),
  });

  const jobs = jobsQuery.data?.jobs ?? [];
  // Search filters client-side over the current page only — the API
  // doesn't have a text-search endpoint yet (a real one would need a
  // dedicated index, not just a LIKE query, at any real scale), so this
  // is a lightweight "filter what I can already see" rather than a
  // claim of searching the user's entire job history.
  const visibleJobs = search
    ? jobs.filter((job) => job.name.toLowerCase().includes(search.toLowerCase()))
    : jobs;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Jobs</h1>
          <p className="mt-1 text-sm text-slate-500">Everything you&apos;ve run, queued, or scheduled.</p>
        </div>
        <Link to="/jobs/create">
          <Button>New job</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-xs"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input w-auto">
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="input w-auto">
          <option value="">All types</option>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {JOB_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="input w-auto">
          <option value="">All priorities</option>
          {JOB_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {jobsQuery.isLoading ? (
        <LoadingState />
      ) : jobsQuery.isError ? (
        <ErrorState
          message={jobsQuery.error instanceof Error ? jobsQuery.error.message : 'Could not load jobs.'}
          onRetry={() => void jobsQuery.refetch()}
        />
      ) : visibleJobs.length === 0 ? (
        <EmptyState
          title="No jobs found"
          description="Try adjusting your filters, or create a new job to get started."
          action={
            <Link to="/jobs/create">
              <Button size="sm">Create a job</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleJobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="max-w-[220px] truncate px-4 py-3 font-medium text-slate-800">{job.name}</td>
                  <td className="px-4 py-3 text-slate-500">{JOB_TYPE_LABELS[job.type]}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{job.priority}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {formatDurationFromDates(job.startedAt, job.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(job.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                        aria-label="View"
                      >
                        <Eye size={15} />
                      </Link>
                      {CANCELLABLE.has(job.status) && (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget({ job, action: 'cancel' })}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          aria-label="Cancel"
                        >
                          <Ban size={15} />
                        </button>
                      )}
                      {RETRYABLE.has(job.status) && (
                        <button
                          type="button"
                          onClick={() => retryMutation.mutate(job.id)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          aria-label="Retry"
                        >
                          <RefreshCw size={15} />
                        </button>
                      )}
                      {DELETABLE.has(job.status) && (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget({ job, action: 'delete' })}
                          className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {jobsQuery.data?.pagination && jobsQuery.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
              <span>
                Page {jobsQuery.data.pagination.page} of {jobsQuery.data.pagination.totalPages} ·{' '}
                {jobsQuery.data.pagination.total} jobs
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= jobsQuery.data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget?.action === 'cancel' ? 'Cancel this job?' : 'Delete this job?'}
        description={
          confirmTarget?.action === 'cancel'
            ? `"${confirmTarget.job.name}" will stop before it starts running.`
            : `"${confirmTarget?.job.name}" and its execution history will be permanently removed.`
        }
        confirmLabel={confirmTarget?.action === 'cancel' ? 'Cancel job' : 'Delete'}
        variant={confirmTarget?.action === 'delete' ? 'danger' : 'primary'}
        isLoading={cancelMutation.isPending || deleteMutation.isPending}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (!confirmTarget) return;
          const mutation = confirmTarget.action === 'cancel' ? cancelMutation : deleteMutation;
          mutation.mutate(confirmTarget.job.id, { onSettled: () => setConfirmTarget(null) });
        }}
      />
    </div>
  );
}
