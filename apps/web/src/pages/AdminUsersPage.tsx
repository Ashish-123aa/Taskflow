import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import type { ApiSuccess, Pagination, SafeUser } from '../lib/types';
import { formatDate } from '../lib/format';
import { Button, ConfirmDialog, ErrorState, LoadingState } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [disableTarget, setDisableTarget] = useState<SafeUser | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'users', { page }],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<SafeUser[]>>('/admin/users', { params: { page, limit: 20 } });
      return { users: res.data.data, pagination: res.data.pagination as Pagination };
    },
    placeholderData: (previous) => previous,
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/users/${id}`, { isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => showToast(err instanceof ApiRequestError ? err.message : 'Could not update user', 'error'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'Could not load users.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">{query.data.pagination.total} accounts</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {query.data.users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{user.name}</td>
                <td className="px-4 py-3 text-slate-500">{user.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.role === 'ADMIN' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {user.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDate(user.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  {user.id === currentUser?.id ? (
                    <span className="text-xs text-slate-400">You</span>
                  ) : user.isActive ? (
                    <Button variant="secondary" size="sm" onClick={() => setDisableTarget(user)}>
                      Disable
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={setActiveMutation.isPending}
                      onClick={() => setActiveMutation.mutate({ id: user.id, isActive: true })}
                    >
                      Enable
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {query.data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
            <span>
              Page {query.data.pagination.page} of {query.data.pagination.totalPages}
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

      <ConfirmDialog
        open={disableTarget !== null}
        title="Disable this account?"
        description={`"${disableTarget?.name}" will no longer be able to log in. You can re-enable it at any time.`}
        confirmLabel="Disable"
        variant="danger"
        isLoading={setActiveMutation.isPending}
        onCancel={() => setDisableTarget(null)}
        onConfirm={() => {
          if (!disableTarget) return;
          setActiveMutation.mutate(
            { id: disableTarget.id, isActive: false },
            { onSettled: () => setDisableTarget(null) },
          );
        }}
      />
    </div>
  );
}
