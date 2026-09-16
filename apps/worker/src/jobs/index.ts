import { registerHandler } from './registry';
import { apiRequestHandler } from './handlers/api-request.handler';
import { csvProcessingHandler } from './handlers/csv-processing.handler';
import { createEmailHandler } from './handlers/email.handler';
import { imageProcessingHandler } from './handlers/image-processing.handler';
import { reportGenerationHandler } from './handlers/report-generation.handler';
import { dataTransformationHandler } from './handlers/data-transformation.handler';
import { createSmtpTransporter } from '../config/mail';
import { env } from '../config/env';

/**
 * Side-effecting bootstrap: calling this registers every implemented job
 * handler. As of Phase 4, every job type in JOB_TYPES has a real handler.
 */
export function registerAllHandlers(): void {
  registerHandler('API_REQUEST', apiRequestHandler);

  // SCHEDULED_API_FETCH does the exact same work as API_REQUEST — fetch a
  // URL, store the response. The only difference is *who creates the job*
  // (a user directly, vs. the scheduler on a timer once Phase 7 exists),
  // not what the worker does with it once it's queued. Rather than
  // duplicate the implementation, both types are registered to the same
  // handler — see docs/worker-system.md.
  registerHandler('SCHEDULED_API_FETCH', apiRequestHandler);

  registerHandler('CSV_PROCESSING', csvProcessingHandler);
  registerHandler('IMAGE_PROCESSING', imageProcessingHandler);
  registerHandler('REPORT_GENERATION', reportGenerationHandler);
  registerHandler('DATA_TRANSFORMATION', dataTransformationHandler);
  registerHandler('EMAIL', createEmailHandler(createSmtpTransporter(env)));
}
