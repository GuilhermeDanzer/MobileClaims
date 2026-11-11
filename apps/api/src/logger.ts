import pino, { type LoggerOptions } from 'pino';

/**
 * Structured JSON logging. Redaction paths keep tokens and secrets out of logs.
 * Fastify consumes the options object; the standalone logger is used by the worker.
 */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { service: 'claims-api' },
    redact: {
      paths: ['req.headers.authorization', 'password', 'secretAccessKey'],
      censor: '[redacted]',
    },
  };
}

export function createLogger(level: string): pino.Logger {
  return pino(loggerOptions(level));
}

export type Logger = pino.Logger;
