import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

interface JobEventPayload {
  jobId: string;
  userId: string;
  type: string;
  status: string;
  progress?: number;
  error?: string;
  timestamp: string;
}

const SocketContext = createContext<Socket | null>(null);

const JOB_EVENT_NAMES = [
  'job:queued',
  'job:started',
  'job:progress',
  'job:completed',
  'job:failed',
  'job:retrying',
  'job:cancelled',
  'job:dead_letter',
] as const;

/**
 * One socket connection per logged-in session, authenticated the same
 * way every HTTP request is (the httpOnly session cookie — see
 * docs/realtime.md on the backend for the full design). Rather than have
 * every page that cares about job updates open its own connection and
 * duplicate the "what do I do with a job:completed event" logic, this
 * connects once at the app root and reacts centrally: invalidate the
 * relevant React Query caches so whatever's on screen refetches, and
 * raise a toast for the states someone would actually want to notice
 * (completed, failed, dead-lettered) without having the job's page open.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io('/', { withCredentials: true });
    socketRef.current = socket;

    const invalidateForJob = (payload: JobEventPayload) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['job', payload.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    };

    for (const eventName of JOB_EVENT_NAMES) {
      socket.on(eventName, (payload: JobEventPayload) => invalidateForJob(payload));
    }

    socket.on('job:completed', () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      showToast(`Job completed`, 'success');
    });
    socket.on('job:failed', () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      showToast(`Job failed`, 'error');
    });
    socket.on('job:dead_letter', () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      showToast(`A job exhausted its retries and moved to the dead-letter queue`, 'error');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return <SocketContext.Provider value={socketRef.current}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
