import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Circle, Download, XCircle } from 'lucide-react';
import { api, ApiRequestError } from '../lib/api';
import type { ApiSuccess, Job } from '../lib/types';
import { JOB_TYPE_LABELS } from '../lib/constants';
import { formatDate, formatDuration, formatDurationFromDates } from '../lib/format';
import { Button, Card, ConfirmDialog, ErrorState, LoadingState, PriorityLabel, StatusBadge } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

const CANCELLABLE = new Set(['PENDING', 'QUEUED']);
const RETRYABLE = new Set(['FAILED', 'DEAD_LETTER']);

export function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<Job>>(`/jobs/${id}`);
      return res.data.data;
    },
    // Live progress: while a job is actively running, poll every couple
    // of seconds as a fallback alongside the WebSocket push (see
    // SocketContext, which also invalidates this exact query key on every
    // job:* event) — belt and suspenders for a page someone might have
    // open before the socket reconnects after a network blip.
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 2000 : false),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/jobs/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', id] });
      showToast('Job cancelled', 'success');
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not cancel job', 'error'),
  });

  const retryMutation = useMutation({
    mutationFn: () => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', id] });
      showToast('Job re-queued', 'success');
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not retry job', 'error'),
  });

  if (jobQuery.isLoading) return <LoadingState />;
  if (jobQuery.isError || !jobQuery.data) {
    return (
      <ErrorState
        message={jobQuery.error instanceof Error ? jobQuery.error.message : 'Could not load this job.'}
        onRetry={() => void jobQuery.refetch()}
      />
    );
  }

  const job = jobQuery.data;
  const hasDownload = Boolean(
    (job.result as { reportFile?: string; outputFile?: string } | null)?.reportFile ||
      (job.result as { reportFile?: string; outputFile?: string } | null)?.outputFile,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/jobs')}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-xl font-bold text-slate-900">{job.name}</h1>
        <StatusBadge status={job.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold text-slate-900">Overview</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <InfoItem label="Type" value={JOB_TYPE_LABELS[job.type]} />
            <InfoItem label="Priority" value={<PriorityLabel priority={job.priority} />} />
            <InfoItem label="Attempts" value={`${job.attempts} / ${job.maxAttempts}`} mono />
            <InfoItem label="Created" value={formatDate(job.createdAt)} />
            <InfoItem label="Started" value={formatDate(job.startedAt)} />
            <InfoItem label="Completed" value={formatDate(job.completedAt)} />
            <InfoItem label="Duration" value={formatDurationFromDates(job.startedAt, job.completedAt)} mono />
            <InfoItem label="Job ID" value={job.id} mono />
          </dl>

          {job.status === 'RUNNING' && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Progress</span>
                <span className="font-mono">{job.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-500 ease-out"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {job.error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">Error</p>
              <p className="mt-0.5 font-mono text-xs">{job.error}</p>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            {CANCELLABLE.has(job.status) && (
              <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel job
              </Button>
            )}
            {RETRYABLE.has(job.status) && (
              <Button size="sm" isLoading={retryMutation.isPending} onClick={() => retryMutation.mutate()}>
                Retry
              </Button>
            )}
            {hasDownload && (
              <a href={`/api/v1/jobs/${job.id}/download`} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  <Download size={14} />
                  Download result
                </Button>
              </a>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900">Execution timeline</h2>
          <ol className="mt-3 flex flex-col gap-3">
            <TimelineStep label="Created" done timestamp={job.createdAt} />
            <TimelineStep label="Queued" done={Boolean(job.startedAt) || job.status !== 'PENDING'} />
            <TimelineStep
              label="Running"
              done={Boolean(job.startedAt)}
              timestamp={job.startedAt}
            />
            <TimelineStep
              label={job.status === 'FAILED' || job.status === 'DEAD_LETTER' ? 'Failed' : 'Completed'}
              done={['COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'].includes(job.status)}
              failed={['FAILED', 'DEAD_LETTER'].includes(job.status)}
              timestamp={job.completedAt ?? job.failedAt}
            />
          </ol>
        </Card>
      </div>

      {job.jobAttempts && job.jobAttempts.length > 0 && (
        <Card className="p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900">Attempts</h2>
          <div className="mt-3 flex flex-col divide-y divide-slate-100">
            {job.jobAttempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  {attempt.status === 'SUCCEEDED' ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : attempt.status === 'FAILED' ? (
                    <XCircle size={16} className="text-red-500" />
                  ) : (
                    <Circle size={16} className="text-blue-500" />
                  )}
                  <span className="font-medium text-slate-700">Attempt {attempt.attemptNumber}</span>
                  {attempt.error && <span className="font-mono text-xs text-red-600">{attempt.error}</span>}
                </div>
                <span className="font-mono text-xs text-slate-400">{formatDuration(attempt.duration)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <JsonCard title="Payload" value={job.payload} />
        <JsonCard title="Result" value={job.result} />
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this job?"
        description={`"${job.name}" will stop before it starts running.`}
        confirmLabel="Cancel job"
        isLoading={cancelMutation.isPending}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => cancelMutation.mutate(undefined, { onSettled: () => setConfirmCancel(false) })}
      />
    </div>
  );
}

function InfoItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function TimelineStep({
  label,
  done,
  failed,
  timestamp,
}: {
  label: string;
  done: boolean;
  failed?: boolean;
  timestamp?: string | null;
}) {
  return (
    <li className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          failed ? 'bg-red-100 text-red-600' : done ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {failed ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
      </div>
      <div>
        <p className={`text-sm font-medium ${done ? 'text-slate-800' : 'text-slate-400'}`}>{label}</p>
        {timestamp && <p className="text-xs text-slate-400">{formatDate(timestamp)}</p>}
      </div>
    </li>
  );
}

function JsonCard({ title, value }: { title: string; value: unknown }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-sm font-semibold text-slate-900">{title}</h2>
      <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
        {value ? JSON.stringify(value, null, 2) : '—'}
      </pre>
    </Card>
  );
}
