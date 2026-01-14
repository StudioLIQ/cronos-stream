const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const currentLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLevel);
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(message: string, data?: unknown) {
    if (shouldLog('debug')) {
      console.log(`[${formatTimestamp()}] DEBUG: ${message}`, data ?? '');
    }
  },
  info(message: string, data?: unknown) {
    if (shouldLog('info')) {
      console.log(`[${formatTimestamp()}] INFO: ${message}`, data ?? '');
    }
  },
  warn(message: string, data?: unknown) {
    if (shouldLog('warn')) {
      console.warn(`[${formatTimestamp()}] WARN: ${message}`, data ?? '');
    }
  },
  error(message: string, data?: unknown) {
    if (shouldLog('error')) {
      console.error(`[${formatTimestamp()}] ERROR: ${message}`, data ?? '');
    }
  },
};
