import type { JobType } from '@taskflow/shared';
import type { JobHandler } from './handler.types';

/**
 * Maps each job type string to the handler that knows how to run it. The
 * worker's processor function never has a switch/if-else over job types —
 * it looks the handler up here. Adding a new job type is: implement
 * JobHandler, call registerHandler() once in jobs/index.ts. Nothing in
 * the worker's core loop changes (section 3).
 */
const registry = new Map<JobType, JobHandler>();

export function registerHandler(type: JobType, handler: JobHandler): void {
  registry.set(type, handler);
}

export function getHandler(type: JobType): JobHandler | undefined {
  return registry.get(type);
}
