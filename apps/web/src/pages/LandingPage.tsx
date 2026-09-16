import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 font-display text-base font-bold text-white">
            T
          </div>
          <span className="font-display text-xl font-bold text-slate-900">TaskFlow</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Log in
          </Link>
          <Link
            to="/register"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Get started
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-2xl font-display text-4xl font-bold text-slate-900 sm:text-5xl">
          Reliable background processing and automation for modern applications.
        </h1>
        <p className="mt-4 max-w-xl text-slate-500">
          Queue CSV imports, API calls, emails, and reports without blocking your API — with
          retries, priorities, and live status, out of the box.
        </p>
        <Link
          to="/register"
          className="mt-8 flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Create a free account
          <ArrowRight size={16} />
        </Link>
      </main>
    </div>
  );
}
