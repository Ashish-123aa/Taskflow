import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { NonRetryableJobError } from '../../utils/errors';
import { env } from '../../config/env';
import type { JobExecutionContext, JobHandler } from '../handler.types';

interface CsvProcessingPayload {
  storedFilename: string;
  originalFilename: string;
  sizeBytes: number;
}

/**
 * Streams the uploaded CSV through csv-parse rather than reading it fully
 * into memory first (section 15: "do not load extremely large files
 * entirely into memory. Use streaming where appropriate"). A row counts
 * as "valid" if it has the same number of columns as the header row; a
 * row with a different column count counts as invalid but does not abort
 * the whole job — one malformed row in a 500,000-row file shouldn't fail
 * the other 499,999.
 */
export const csvProcessingHandler: JobHandler = {
  async execute(ctx: JobExecutionContext) {
    const payload = ctx.payload as unknown as CsvProcessingPayload;

    if (!payload?.storedFilename) {
      throw new NonRetryableJobError('CSV_PROCESSING payload requires "storedFilename"');
    }

    const filePath = path.join(env.UPLOAD_DIR, payload.storedFilename);
    if (!fs.existsSync(filePath)) {
      // Not retryable — the file isn't going to reappear on attempt 2 if
      // it's missing on attempt 1.
      throw new NonRetryableJobError(`Uploaded file not found: ${payload.storedFilename}`);
    }

    const start = Date.now();
    const fileSize = fs.statSync(filePath).size;

    let headerLength = 0;
    let totalRows = 0;
    let validRows = 0;
    let invalidRows = 0;
    let bytesRead = 0;
    let lastReportedProgress = 0;

    await new Promise<void>((resolve, reject) => {
      const parser = parse({
        columns: false,
        skip_empty_lines: true,
        trim: true,
        // Without this, csv-parse throws and aborts the entire parse the
        // moment it sees one row with a different column count than the
        // header. That's the opposite of what section 15 wants: one
        // malformed row in a 500,000-row file should be counted as
        // invalid, not crash processing of the other 499,999.
        relax_column_count: true,
      });
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk: Buffer) => {
        bytesRead += chunk.length;
        const percent = fileSize > 0 ? Math.round((bytesRead / fileSize) * 100) : 0;
        if (percent >= lastReportedProgress + 5) {
          lastReportedProgress = percent;
          // Fire-and-forget on purpose: awaiting inside a stream 'data'
          // handler would interfere with the stream's own backpressure.
          // Progress reporting is best-effort, not part of parse
          // correctness.
          void ctx.updateProgress(Math.min(percent, 99));
        }
      });

      parser.on('readable', () => {
        let record: string[] | null = parser.read();
        while (record !== null) {
          if (totalRows === 0) {
            headerLength = record.length;
          } else if (record.length === headerLength) {
            validRows += 1;
          } else {
            invalidRows += 1;
          }
          totalRows += 1;
          record = parser.read();
        }
      });

      parser.on('error', reject);
      parser.on('end', () => resolve());
      stream.on('error', reject);
      stream.pipe(parser);
    });

    await ctx.updateProgress(100);

    // The header row itself isn't a data row.
    const dataRowCount = Math.max(totalRows - 1, 0);

    return {
      totalRows: dataRowCount,
      validRows,
      invalidRows,
      processingTimeSeconds: Number(((Date.now() - start) / 1000).toFixed(2)),
    };
  },
};
