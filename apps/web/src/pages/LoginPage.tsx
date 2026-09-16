import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { loginSchema, type LoginFormValues } from '../lib/schemas';
import { ApiRequestError } from '../lib/api';
import { Button } from '../components/ui';
import { AuthShell, Field } from './AuthShell';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);
    try {
      await login(values);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from ?? '/dashboard', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your background jobs."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4">
        <Field label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="email" className="input" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input
            type="password"
            autoComplete="current-password"
            className="input"
            {...register('password')}
          />
        </Field>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <Button type="submit" isLoading={isSubmitting} className="mt-1 w-full">
          Log in
        </Button>
      </form>
    </AuthShell>
  );
}
