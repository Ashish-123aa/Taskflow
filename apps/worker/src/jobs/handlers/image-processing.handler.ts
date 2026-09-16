import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NonRetryableJobError } from '../../utils/errors';
import { env } from '../../config/env';
import type { JobExecutionContext, JobHandler } from '../handler.types';

interface ImageProcessingPayload {
  storedFilename: string;
  originalFilename: string;
  operations?: {
    resize?: { width?: number; height?: number };
    format?: 'jpeg' | 'png' | 'webp';
  };
}

// Output files land in a subfolder of the shared upload volume, kept
// separate from user-uploaded input files — see docs/file-handling.md.
const GENERATED_SUBDIR = 'generated';

export const imageProcessingHandler: JobHandler = {
  async execute(ctx: JobExecutionContext) {
    const payload = ctx.payload as unknown as ImageProcessingPayload;

    if (!payload?.storedFilename) {
      throw new NonRetryableJobError('IMAGE_PROCESSING payload requires "storedFilename"');
    }

    const inputPath = path.join(env.UPLOAD_DIR, payload.storedFilename);
    if (!fs.existsSync(inputPath)) {
      throw new NonRetryableJobError(`Uploaded file not found: ${payload.storedFilename}`);
    }

    await ctx.updateProgress(10);

    const originalStats = fs.statSync(inputPath);
    let pipeline = sharp(inputPath);
    const metadata = await pipeline.metadata();

    const { resize, format } = payload.operations ?? {};
    if (resize?.width || resize?.height) {
      // `fit: 'inside'` + `withoutEnlargement` means the requested
      // width/height are a maximum, never a forced stretch — a portrait
      // photo asked to fit 800x800 comes out smaller on one axis, not
      // distorted to a square.
      pipeline = pipeline.resize(resize.width, resize.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const outputFormat = format ?? (metadata.format as 'jpeg' | 'png' | 'webp' | undefined) ?? 'jpeg';
    pipeline = pipeline.toFormat(outputFormat);

    await ctx.updateProgress(50);

    const outputDir = path.join(env.UPLOAD_DIR, GENERATED_SUBDIR);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFilename = `${path.parse(payload.storedFilename).name}-processed.${outputFormat}`;
    const outputPath = path.join(outputDir, outputFilename);

    const outputInfo = await pipeline.toFile(outputPath);

    await ctx.updateProgress(100);

    return {
      originalSizeBytes: originalStats.size,
      processedSizeBytes: outputInfo.size,
      width: outputInfo.width,
      height: outputInfo.height,
      format: outputInfo.format,
      // Relative to UPLOAD_DIR — this is what GET /jobs/:id/download reads.
      outputFile: path.join(GENERATED_SUBDIR, outputFilename),
    };
  },
};
