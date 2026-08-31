import { config } from '../config';

type Level = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_PRIORITY: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const threshold = LEVEL_PRIORITY[config.logLevel as Level] ?? LEVEL_PRIORITY.info;

/**
 * Emits one JSON object per line in production so log aggregators can parse it,
 * and a compact human-readable line in development.
 */
const write = (level: Level, message: string, context?: Record<string, unknown>): void => {
  if (LEVEL_PRIORITY[level] > threshold) return;

  const timestamp = new Date().toISOString();

  if (config.isProduction) {
    process.stdout.write(`${JSON.stringify({ timestamp, level, message, ...context })}\n`);
    return;
  }

  const suffix = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  process.stdout.write(`${timestamp} [${level.toUpperCase()}] ${message}${suffix}\n`);
};

export const logger = {
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
};

/** Reduce an unknown thrown value to a message safe to log. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
