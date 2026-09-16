import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, Clock, ListChecks, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import type { ApiSuccess, DashboardStats } from '../lib/types';
import { JOB_TYPE_LABELS, STATUS_LABELS, type JobStatus, type JobType } from '../lib/constants';
import { formatDuration } from '../lib/format';
import { Card, ErrorState, LoadingState } from '../components/ui';

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#94a3b8',
  QUEUED: '#f59e0b',
  RUNNING: '#3b82f6',
  COMPLETED: '#10b981',
  FAILED: '#ef4444',
  RETRYING: '#f97316',
  CANCELLED: '#64748b',
  DEAD_LETTER: '#a855f7',
};

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<DashboardStats>>('/dashboard/stats');
      return res.data.data;
    },
  });

  if (isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (isError || !data) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Could not load dashboard stats.'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          An overview of your background jobs over the last 14 days.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total jobs" value={data.totalJobs} icon={ListChecks} tint="brand" />
        <StatCard label="Success rate" value={`${data.successRate}%`} icon={CheckCircle2} tint="emerald" />
        <StatCard label="Running now" value={data.runningJobs} icon={Clock} tint="blue" />
        <StatCard label="Failed" value={data.failedJobs} icon={XCircle} tint="red" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SmallStat label="Queued" value={data.queuedJobs} />
        <SmallStat label="Completed" value={data.completedJobs} />
        <SmallStat label="Avg. processing time" value={formatDuration(data.avgProcessingTimeMs)} />
        <SmallStat label="Job types in use" value={data.jobsByType.length} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold text-slate-900">Jobs over time</h2>
          <p className="text-xs text-slate-500">Created vs. completed vs. failed, last 14 days</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.jobsOverTime}>
                <defs>
                  <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5b5ff0" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#5b5ff0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value: string) => value.slice(5)}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: '#e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Created"
                  stroke="#5b5ff0"
                  fill="url(#totalGradient)"
                  strokeWidth={2}
                />
                <Area type="monotone" dataKey="completed" name="Completed" stroke="#10b981" fill="none" strokeWidth={2} />
                <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" fill="none" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900">Jobs by status</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.jobsByStatus}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.jobsByStatus.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, _name, item) => [
                    value,
                    STATUS_LABELS[(item.payload as { status: JobStatus }).status] ?? item.payload,
                  ]}
                  contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: '#e2e8f0' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {data.jobsByStatus.length === 0 && (
            <p className="text-center text-xs text-slate-400">No jobs yet</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-display text-sm font-semibold text-slate-900">Jobs by type</h2>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.jobsByType} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="type"
                tickFormatter={(value: string) => JOB_TYPE_LABELS[value as JobType] ?? value}
                width={140}
                tick={{ fontSize: 12, fill: '#475569' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: number) => [value, 'Jobs']}
                labelFormatter={(label: string) => JOB_TYPE_LABELS[label as JobType] ?? label}
                contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: '#e2e8f0' }}
              />
              <Bar dataKey="count" fill="#5b5ff0" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tint,
}: {
  label: string;
  value: string | number;
  icon: typeof ListChecks;
  tint: 'brand' | 'emerald' | 'blue' | 'red';
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tints[tint]}`}>
          <Icon size={19} />
        </div>
        <div>
          <p className="font-display text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </Card>
  );
}

function SmallStat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="font-display text-xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </Card>
  );
}
