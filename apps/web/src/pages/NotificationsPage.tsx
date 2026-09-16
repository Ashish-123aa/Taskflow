import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import type { ApiSuccess, Notification } from '../lib/types';
import { formatRelativeTime } from '../lib/format';
import { Card, EmptyState, ErrorState, LoadingState } from '../components/ui';

const TYPE_DOT: Record<string, string> = {
  JOB_COMPLETED: 'bg-emerald-500',
  JOB_FAILED: 'bg-red-500',
  JOB_DEAD_LETTER: 'bg-purple-500',
  SCHEDULE_TRIGGERED: 'bg-brand-500',
  SYSTEM_ERROR: 'bg-slate-500',
};

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications', { unreadOnly }],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<Notification[]>>('/notifications', {
        params: { limit: 50, unreadOnly: unreadOnly || undefined },
      });
      return { notifications: res.data.data, unreadCount: res.data.unreadCount ?? 0 };
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'Could not load notifications.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">{query.data.unreadCount} unread</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="rounded border-slate-300"
          />
          Unread only
        </label>
      </div>

      {query.data.notifications.length === 0 ? (
        <EmptyState title="No notifications" description="You're all caught up." />
      ) : (
        <Card className="divide-y divide-slate-100">
          {query.data.notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 p-4 ${!n.isRead ? 'bg-brand-50/40' : ''}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[n.type] ?? 'bg-slate-400'}`} />
              <div className="flex-1">
                <p className="text-sm text-slate-800">{n.message}</p>
                <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                  <span>{formatRelativeTime(n.createdAt)}</span>
                  {n.jobId && (
                    <Link to={`/jobs/${n.jobId}`} className="font-medium text-brand-600 hover:text-brand-700">
                      View job
                    </Link>
                  )}
                </div>
              </div>
              {!n.isRead && (
                <button
                  type="button"
                  onClick={() => markReadMutation.mutate(n.id)}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Mark as read"
                >
                  <CheckCheck size={15} />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
