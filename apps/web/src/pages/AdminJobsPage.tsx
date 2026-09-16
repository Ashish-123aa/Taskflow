import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RefreshCw } from 'lucide-react';
import { api, ApiRequestError } from '../lib/api';
import type { ApiSuccess, Job, Pagination } from '../lib/types';
import { JOB_STATUSES, JOB_TYPE_LABELS } from '../lib/constants';
import { formatDate } from '../lib/format';
import { Button, EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

const RETRYABLE = new Set(['FAILED', 'DEAD_LETTER']);

export function AdminJobsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const query = useQuery({
    queryKey: ['admin', 'jobs', { page, status, userId }],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<Job[]>>('/admin/jobs', {
        params: { page, limit: 20, status: status || undefined, userId: userId || undefined },
      });
      return { jobs: res.data.data, pagination: res.data.pagination as Pagination };
    },
    placeholderData: (previous) => previous,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'jobs'] });
      showToast('Job re-queued', 'success');
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not retry job', 'error'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'Could not load jobs.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">All jobs</h1>
        <p className="mt-1 text-sm text-slate-500">Every job across every user — admin view.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="input w-auto"
        >
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => { setStatus('DEAD_LETTER'); setPage(1); }}
          className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
        >
          Dead-letter jobs only
        </button>
        <input
          type="text"
          placeholder="Filter by user ID…"
          value={userId}
          onChange={(e) => { setUserId(e.target.value); setPage(1); }}
          className="input max-w-xs font-mono text-xs"
        />
      </div>

      {query.data.jobs.length === 0 ? (
        <EmptyState title="No jobs found" description="Try adjusting your filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="max-w-[220px] truncate px-4 py-3 font-medium text-slate-800">{job.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{job.userId}</td>
                  <td className="px-4 py-3 text-slate-500">{JOB_TYPE_LABELS[job.type]}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
              <span>
                Page {query.data.pagination.page} of {query.data.pagination.totalPages} · {query.data.pagination.total} jobs
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= query.data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
