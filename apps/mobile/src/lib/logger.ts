/**
 * Логгер приложения.
 *
 * Единая точка логирования в mobile: уровни, префикс и контекст.
 * В дев-режиме пишет всё, в проде — info и выше. На смену/при отклонениях —
 * крючок для Sentry или другого удалённого логирования.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const isDev = Boolean((globalThis as Record<string, unknown>).__DEV__);

const MIN_LEVEL: LogLevel = isDev ? 'debug' : 'info';

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const tag = `AgroMoll:${level}`;
  const payload = context ? `${message} ${JSON.stringify(context)}` : message;

  if (level === 'error') console.error(tag, payload);
  else if (level === 'warn') console.warn(tag, payload);
  else console.log(tag, payload);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};
