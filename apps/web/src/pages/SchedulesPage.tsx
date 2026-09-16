import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '../lib/api';
import type { ApiSuccess, Schedule } from '../lib/types';
import { JOB_PRIORITIES, JOB_TYPES, JOB_TYPE_LABELS, type JobPriority, type JobType } from '../lib/constants';
import { formatDate, formatRelativeTime } from '../lib/format';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { Field } from './AuthShell';
import { useToast } from '../contexts/ToastContext';

export function SchedulesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const query = useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<Schedule[]>>('/schedules', { params: { limit: 50 } });
      return res.data.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/schedules/${id}`, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
      showToast('Schedule deleted', 'success');
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'Could not load schedules.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Schedules</h1>
          <p className="mt-1 text-sm text-slate-500">Recurring jobs, triggered automatically by cron.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={16} />
          New schedule
        </Button>
      </div>

      {query.data.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Create one to have TaskFlow run a job automatically on a cron pattern."
          action={<Button size="sm" onClick={() => setShowCreate(true)}>Create a schedule</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {query.data.map((schedule) => (
            <Card key={schedule.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-sm font-semibold text-slate-900">{schedule.name}</p>
                  <p className="text-xs text-slate-500">{JOB_TYPE_LABELS[schedule.jobType]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(schedule)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete schedule"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <p className="mt-2 font-mono text-xs text-slate-500">{schedule.cronExpression}</p>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>
                  Next run: {schedule.isActive ? formatRelativeTime(schedule.nextRunAt) : 'paused'}
                </span>
                {schedule.lastRunAt && <span>Last run: {formatDate(schedule.lastRunAt)}</span>}
              </div>

              {schedule.lastError && (
                <p className="mt-2 rounded bg-red-50 px-2 py-1 font-mono text-xs text-red-700">
                  {schedule.lastError}
                </p>
              )}

              <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={schedule.isActive}
                  onChange={(e) => toggleMutation.mutate({ id: schedule.id, isActive: e.target.checked })}
                  className="rounded border-slate-300"
                />
                Active
              </label>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateScheduleDialog onClose={() => setShowCreate(false)} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this schedule?"
        description={`"${deleteTarget?.name}" will stop creating new jobs. This can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}

function CreateScheduleDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [jobType, setJobType] = useState<JobType>('API_REQUEST');
  const [cronExpression, setCronExpression] = useState('0 8 * * *');
  const [priority, setPriority] = useState<JobPriority>('MEDIUM');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/schedules', {
        name,
        jobType,
        cronExpression,
        priority,
        payload: jobType === 'API_REQUEST' || jobType === 'SCHEDULED_API_FETCH' ? { url } : {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
      showToast('Schedule created', 'success');
      onClose();
    },
    onError: (err) => setFormError(err instanceof ApiRequestError ? err.message : 'Could not create schedule'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl animate-slide-in">
        <h3 className="font-display text-base font-semibold text-slate-900">New schedule</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createMutation.mutate();
          }}
          className="mt-4 flex flex-col gap-3"
        >
          <Field label="Name">
            <input required type="text" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Job type">
            <select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)} className="input">
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          {(jobType === 'API_REQUEST' || jobType === 'SCHEDULED_API_FETCH') && (
            <Field label="URL">
              <input required type="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
          )}
          <Field label="Cron expression">
            <input
              required
              type="text"
              className="input font-mono"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
            />
            <span className="text-xs text-slate-400">e.g. "0 8 * * *" for every day at 8am UTC</span>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)} className="input">
              {JOB_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
