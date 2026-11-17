import { describe, expect, it, vi } from 'vitest';
import { registerHandler, getHandler } from '../src/jobs/registry';
import type { JobHandler } from '../src/jobs/handler.types';

function fakeHandler(): JobHandler {
  return { execute: vi.fn().mockResolvedValue({}) };
}

describe('job handler registry', () => {
  // The registry is a module-level singleton Map, so tests share state
  // across the file — use distinct fake job types per test rather than
  // resetting the module, matching how registerAllHandlers() itself
  // only ever calls registerHandler() additively at startup and never
  // needs to "unregister" anything in real operation.

  it('returns undefined for a type nothing has registered yet', () => {
    expect(getHandler('CSV_PROCESSING')).toBeUndefined();
  });

  it('returns exactly the handler that was registered for a type', () => {
    const handler = fakeHandler();
    registerHandler('EMAIL', handler);

    expect(getHandler('EMAIL')).toBe(handler);
  });

  it('keeps different job types independent', () => {
    const apiRequestHandler = fakeHandler();
    const reportHandler = fakeHandler();

    registerHandler('API_REQUEST', apiRequestHandler);
    registerHandler('REPORT_GENERATION', reportHandler);

    expect(getHandler('API_REQUEST')).toBe(apiRequestHandler);
    expect(getHandler('REPORT_GENERATION')).toBe(reportHandler);
    expect(getHandler('DATA_TRANSFORMATION')).toBeUndefined();
  });

  it('lets the same handler instance be registered under two different types (SCHEDULED_API_FETCH reuses API_REQUEST\'s handler)', () => {
    const sharedHandler = fakeHandler();
    registerHandler('IMAGE_PROCESSING', sharedHandler);
    registerHandler('SCHEDULED_API_FETCH', sharedHandler);

    expect(getHandler('IMAGE_PROCESSING')).toBe(sharedHandler);
    expect(getHandler('SCHEDULED_API_FETCH')).toBe(sharedHandler);
  });

  it('re-registering a type overwrites its previous handler', () => {
    const first = fakeHandler();
    const second = fakeHandler();

    registerHandler('DATA_TRANSFORMATION', first);
    registerHandler('DATA_TRANSFORMATION', second);

    expect(getHandler('DATA_TRANSFORMATION')).toBe(second);
  });
});
