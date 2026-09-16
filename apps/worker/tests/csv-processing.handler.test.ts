import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noopProgress = async () => {};

describe('csvProcessingHandler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-csv-test-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function loadHandlerWithUploadDir(uploadDir: string) {
    process.env.UPLOAD_DIR = uploadDir;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/taskflow_test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const mod = await import('../src/jobs/handlers/csv-processing.handler');
    return mod.csvProcessingHandler;
  }

  it('counts valid and invalid rows, streaming from disk', async () => {
    const csvContent = [
      'name,age,city',
      'Ada,30,London',
      'Grace,,New York', // still valid: same column count, just an empty cell
      'Alan,28', // invalid: only 2 columns, header has 3
      'Katherine,29,Cleveland',
    ].join('\n');

    const filename = 'sample.csv';
    fs.writeFileSync(path.join(tempDir, filename), csvContent, 'utf-8');

    const handler = await loadHandlerWithUploadDir(tempDir);

    const result = await handler.execute({
      jobId: '1',
      userId: 'u1',
      attempt: 1,
      updateProgress: noopProgress,
      payload: {
        storedFilename: filename,
        originalFilename: 'sample.csv',
        sizeBytes: csvContent.length,
      },
    });

    expect(result.totalRows).toBe(4);
    expect(result.validRows).toBe(3);
    expect(result.invalidRows).toBe(1);
    expect(typeof result.processingTimeSeconds).toBe('number');
  });

  it('throws a non-retryable error when the file does not exist', async () => {
    const handler = await loadHandlerWithUploadDir(tempDir);
    const { NonRetryableJobError } = await import('../src/utils/errors');

    await expect(
      handler.execute({
        jobId: '1',
        userId: 'u1',
        attempt: 1,
        updateProgress: noopProgress,
        payload: { storedFilename: 'does-not-exist.csv', originalFilename: 'x.csv', sizeBytes: 0 },
      }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('throws a non-retryable error when no storedFilename is given', async () => {
    const handler = await loadHandlerWithUploadDir(tempDir);
    const { NonRetryableJobError } = await import('../src/utils/errors');

    await expect(
      handler.execute({
        jobId: '1',
        userId: 'u1',
        attempt: 1,
        updateProgress: noopProgress,
        payload: {},
      }),
    ).rejects.toThrow(NonRetryableJobError);
  });
});
