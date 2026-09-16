import type { ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 font-display text-base font-bold text-white">
            T
          </div>
          <span className="font-display text-xl font-bold text-slate-900">TaskFlow</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-900/5">
          <h1 className="font-display text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">{footer}</p>
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}
