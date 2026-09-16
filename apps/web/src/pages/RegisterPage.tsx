import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { registerSchema, type RegisterFormValues } from '../lib/schemas';
import { ApiRequestError } from '../lib/api';
import { Button } from '../components/ui';
import { AuthShell, Field } from './AuthShell';

export function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);
    try {
      await registerUser(values);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start running background jobs in a couple of minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4">
        <Field label="Name" error={errors.name?.message}>
          <input type="text" autoComplete="name" className="input" {...register('name')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="email" className="input" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            {...register('password')}
          />
          <span className="text-xs text-slate-400">
            At least 8 characters, with an uppercase letter, a lowercase letter, and a number.
          </span>
        </Field>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <Button type="submit" isLoading={isSubmitting} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
