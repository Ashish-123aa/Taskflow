import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { JobStatus, JobPriority } from '../lib/constants';
import { STATUS_LABELS } from '../lib/constants';

// ── Card ─────────────────────────────────────────────────────────────────

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>
  );
}

// ── Button ───────────────────────────────────────────────────────────────

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  isLoading?: boolean;
}

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'
      } ${BUTTON_VARIANTS[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────

const STATUS_DOT_CLASS: Record<JobStatus, string> = {
  PENDING: 'bg-status-pending',
  QUEUED: 'bg-status-queued',
  RUNNING: 'bg-status-running',
  COMPLETED: 'bg-status-completed',
  FAILED: 'bg-status-failed',
  RETRYING: 'bg-status-retrying',
  CANCELLED: 'bg-status-cancelled',
  DEAD_LETTER: 'bg-status-deadletter',
};

const STATUS_TEXT_CLASS: Record<JobStatus, string> = {
  PENDING: 'text-slate-600 bg-slate-100',
  QUEUED: 'text-amber-700 bg-amber-50',
  RUNNING: 'text-blue-700 bg-blue-50',
  COMPLETED: 'text-emerald-700 bg-emerald-50',
  FAILED: 'text-red-700 bg-red-50',
  RETRYING: 'text-orange-700 bg-orange-50',
  CANCELLED: 'text-slate-600 bg-slate-100',
  DEAD_LETTER: 'text-purple-700 bg-purple-50',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TEXT_CLASS[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_CLASS: Record<JobPriority, string> = {
  LOW: 'text-slate-500',
  MEDIUM: 'text-slate-700',
  HIGH: 'text-amber-700',
  CRITICAL: 'text-red-700',
};

export function PriorityLabel({ priority }: { priority: JobPriority }) {
  return <span className={`text-xs font-semibold uppercase tracking-wide ${PRIORITY_CLASS[priority]}`}>{priority}</span>;
}

// ── Empty / error / loading states ─────────────────────────────────────

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 size={22} className="animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Inbox size={22} />
      </div>
      <p className="font-display text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
        <AlertTriangle size={22} />
      </div>
      <p className="font-display text-sm font-semibold text-slate-700">Something went wrong</p>
      <p className="max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
    </div>
  );
}

// ── Confirm dialog ───────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'primary',
  isLoading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'primary' | 'danger';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl animate-slide-in">
        <h3 className="font-display text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1.5 text-sm text-slate-600">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant={variant} size="sm" onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
