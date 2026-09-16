import winston from 'winston';

/**
 * A logger factory rather than a singleton, because two different
 * processes (API and worker) each need their own logger tagged with which
 * process it came from — `defaultMeta: { service }` makes that visible in
 * every log line without either process's call sites having to repeat it.
 * Moved here (rather than duplicated in apps/api and apps/worker) once it
 * became clear both needed the identical setup — see docs/architecture.md.
 */
export function createLogger(service: string, isProduction: boolean) {
  return winston.createLogger({
    level: isProduction ? 'info' : 'debug',
    defaultMeta: { service },
    format: isProduction
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        )
      : winston.format.combine(
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, service: svc, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${svc}] [${level}] ${message}${metaStr}`;
          }),
        ),
    transports: [new winston.transports.Console()],
  });
}
