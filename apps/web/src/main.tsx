import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { SocketProvider } from './contexts/SocketContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 means "not logged in", not "transient network error" — no
      // amount of retrying fixes that, and retrying it just delays the
      // redirect to /login a real auth failure should trigger instantly.
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
  },
});

/**
 * Provider order matters here: ToastProvider before SocketProvider,
 * since the socket's event handlers call useToast(); AuthProvider before
 * SocketProvider, since the socket only connects once there's a logged-in
 * user to authenticate as (see SocketContext.tsx).
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <App />
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
