import type { JobPriority, JobStatus, JobType } from './constants';

export type Role = 'USER' | 'ADMIN';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface JobAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  duration: number | null;
}

export interface Job {
  id: string;
  userId: string;
  type: JobType;
  name: string;
  status: JobStatus;
  priority: JobPriority;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  jobAttempts?: JobAttempt[];
}

export interface Schedule {
  id: string;
  userId: string;
  name: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  cronExpression: string;
  priority: JobPriority;
  maxAttempts: number | null;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'JOB_DEAD_LETTER'
  | 'SCHEDULE_TRIGGERED'
  | 'SYSTEM_ERROR';

export interface Notification {
  id: string;
  userId: string;
  jobId: string | null;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: Pagination;
  unreadCount?: number;
}

export interface ApiError {
  success: false;
  message: string;
  errorCode: string;
  details?: unknown;
}

export interface DashboardStats {
  totalJobs: number;
  completedJobs: number;
  runningJobs: number;
  failedJobs: number;
  queuedJobs: number;
  successRate: number;
  avgProcessingTimeMs: number;
  jobsByType: { type: string; count: number }[];
  jobsByStatus: { status: string; count: number }[];
  jobsOverTime: { date: string; total: number; completed: number; failed: number }[];
}
