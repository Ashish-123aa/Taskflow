import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/format';
import { Card } from '../components/ui';

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <h1 className="font-display text-2xl font-bold text-slate-900">Profile</h1>

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-xl font-semibold text-brand-700">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-display text-lg font-semibold text-slate-900">{user.name}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm">
          <div>
            <dt className="text-xs text-slate-400">Role</dt>
            <dd className="mt-0.5 text-slate-800">{user.role}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Member since</dt>
            <dd className="mt-0.5 text-slate-800">{formatDate(user.createdAt)}</dd>
          </div>
        </dl>

        {/* There's no PATCH /auth/me endpoint yet — editing a profile
            (name, password change) is a reasonable future addition, not
            implemented in this phase. Shown here rather than a form that
            would silently do nothing. */}
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          Profile editing isn&apos;t available yet.
        </p>
      </Card>
    </div>
  );
}
