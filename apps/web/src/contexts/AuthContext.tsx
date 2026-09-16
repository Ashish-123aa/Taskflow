import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import type { ApiSuccess, SafeUser } from '../lib/types';
import type { LoginFormValues, RegisterFormValues } from '../lib/schemas';

interface AuthContextValue {
  user: SafeUser | null;
  isLoading: boolean;
  login: (values: LoginFormValues) => Promise<void>;
  register: (values: RegisterFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
  registerError: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * There's no token in localStorage to check synchronously — the session
 * lives in an httpOnly cookie the frontend can't read. So "am I logged
 * in" is answered by actually asking the API (`GET /auth/me`) once on
 * load, and treating a 401 as "not logged in" rather than an error to
 * surface. Every other piece of the app that needs to know the current
 * user reads it from this query's cache via useAuth(), not by re-fetching.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        const res = await api.get<ApiSuccess<SafeUser>>('/auth/me');
        return res.data.data;
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const res = await api.post<ApiSuccess<SafeUser>>('/auth/login', values);
      return res.data.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['auth', 'me'], user);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (values: RegisterFormValues) => {
      const res = await api.post<ApiSuccess<SafeUser>>('/auth/register', values);
      return res.data.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['auth', 'me'], user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], null);
      // Every other cached query (jobs, notifications, schedules...)
      // belonged to whoever was just logged in. Clearing everything
      // rather than just the auth entry means the next person to log in
      // on this browser never briefly sees a flash of the previous
      // user's data before their own queries refetch.
      queryClient.clear();
    },
  });

  const value: AuthContextValue = {
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    login: async (values) => {
      await loginMutation.mutateAsync(values);
    },
    register: async (values) => {
      await registerMutation.mutateAsync(values);
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
    loginError: loginMutation.error instanceof Error ? loginMutation.error.message : null,
    registerError: registerMutation.error instanceof Error ? registerMutation.error.message : null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
