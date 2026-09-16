import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from './env';

/**
 * A factory rather than a module-level singleton, specifically so the
 * EMAIL handler can be constructed with a different transporter in tests
 * (nodemailer's built-in jsonTransport, which never touches the network)
 * than it is in production (a real SMTP connection, MailHog locally) —
 * see jobs/index.ts and tests/email.handler.test.ts.
 */
export function createSmtpTransporter(
  env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASSWORD'>,
): Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false, // MailHog and most local/dev SMTP servers don't use TLS
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
}
