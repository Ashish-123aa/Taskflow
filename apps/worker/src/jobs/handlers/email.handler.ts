import type { Transporter } from 'nodemailer';
import { NonRetryableJobError } from '../../utils/errors';
import { env } from '../../config/env';
import type { JobExecutionContext, JobHandler } from '../handler.types';

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A factory rather than a plain handler export: the SMTP transporter is
 * injected, not constructed inside the handler. Production wiring
 * (jobs/index.ts) passes a real SMTP transporter built from env
 * (MailHog locally); tests pass nodemailer's built-in jsonTransport,
 * which validates and "sends" a message entirely in-memory with no
 * network call at all — see tests/email.handler.test.ts.
 */
export function createEmailHandler(transporter: Transporter): JobHandler {
  return {
    async execute(ctx: JobExecutionContext) {
      const payload = ctx.payload as unknown as EmailPayload;

      if (!payload?.to || !EMAIL_PATTERN.test(payload.to)) {
        throw new NonRetryableJobError(
          `"${payload?.to}" is not a valid recipient email address`,
        );
      }
      if (!payload.subject) {
        throw new NonRetryableJobError('EMAIL payload requires a "subject"');
      }

      await ctx.updateProgress(20);

      // A genuine SMTP connection failure (server down, network blip) is
      // left to throw a plain Error here and propagate as retryable —
      // only input-shape problems (bad address, missing subject) are
      // classified non-retryable above.
      const info = await transporter.sendMail({
        from: env.SMTP_FROM,
        to: payload.to,
        subject: payload.subject,
        text: payload.body,
      });

      await ctx.updateProgress(100);

      return {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        envelope: info.envelope,
        timestamp: new Date().toISOString(),
      };
    },
  };
}
