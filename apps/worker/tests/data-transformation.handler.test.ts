import { describe, expect, it } from 'vitest';
import { dataTransformationHandler } from '../src/jobs/handlers/data-transformation.handler';
import { NonRetryableJobError } from '../src/utils/errors';

const noopProgress = async () => {};
const baseCtx = { jobId: '1', userId: 'u1', attempt: 1, updateProgress: noopProgress };

describe('dataTransformationHandler', () => {
  it('rejects a payload with no input array', async () => {
    await expect(
      dataTransformationHandler.execute({ ...baseCtx, payload: { operations: [] } }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('rejects a payload with no operations array', async () => {
    await expect(
      dataTransformationHandler.execute({ ...baseCtx, payload: { input: [] } }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('filters rows by equality', async () => {
    const result = await dataTransformationHandler.execute({
      ...baseCtx,
      payload: {
        input: [{ status: 'active' }, { status: 'inactive' }, { status: 'active' }],
        operations: [{ type: 'filter', field: 'status', operator: 'eq', value: 'active' }],
      },
    });

    expect(result.inputCount).toBe(3);
    expect(result.outputCount).toBe(2);
  });

  it('maps a field with a named transform', async () => {
    const result = await dataTransformationHandler.execute({
      ...baseCtx,
      payload: {
        input: [{ name: '  ada  ' }],
        operations: [{ type: 'map', field: 'name', transform: 'trim' }, { type: 'map', field: 'name', transform: 'uppercase' }],
      },
    });

    expect((result.output as Array<Record<string, unknown>>)[0].name).toBe('ADA');
  });

  it('sorts rows ascending and descending', async () => {
    const input = [{ n: 3 }, { n: 1 }, { n: 2 }];

    const asc = await dataTransformationHandler.execute({
      ...baseCtx,
      payload: { input, operations: [{ type: 'sort', field: 'n', direction: 'asc' }] },
    });
    expect((asc.output as Array<{ n: number }>).map((r) => r.n)).toEqual([1, 2, 3]);

    const desc = await dataTransformationHandler.execute({
      ...baseCtx,
      payload: { input, operations: [{ type: 'sort', field: 'n', direction: 'desc' }] },
    });
    expect((desc.output as Array<{ n: number }>).map((r) => r.n)).toEqual([3, 2, 1]);
  });

  it('chains filter, map, and sort in the order given', async () => {
    const result = await dataTransformationHandler.execute({
      ...baseCtx,
      payload: {
        input: [
          { name: 'bob', score: 10 },
          { name: 'ada', score: 30 },
          { name: 'cy', score: 20 },
        ],
        operations: [
          { type: 'filter', field: 'score', operator: 'gt', value: 5 },
          { type: 'map', field: 'name', transform: 'uppercase' },
          { type: 'sort', field: 'score', direction: 'desc' },
        ],
      },
    });

    expect((result.output as Array<Record<string, unknown>>).map((r) => r.name)).toEqual([
      'ADA',
      'CY',
      'BOB',
    ]);
  });

  it('reports progress once per operation', async () => {
    const progressUpdates: number[] = [];
    await dataTransformationHandler.execute({
      jobId: '1',
      userId: 'u1',
      attempt: 1,
      updateProgress: async (p) => {
        progressUpdates.push(p);
      },
      payload: {
        input: [{ a: 1 }],
        operations: [
          { type: 'map', field: 'a', transform: 'toString' },
          { type: 'sort', field: 'a' },
        ],
      },
    });

    expect(progressUpdates).toEqual([50, 100]);
  });
});
