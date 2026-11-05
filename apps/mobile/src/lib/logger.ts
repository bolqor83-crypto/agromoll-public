type Level = 'debug' | 'info' | 'warn' | 'error';

type LogScope = string;

type LogData = Record<string, unknown>;

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function format(scope: LogScope, message: string, data?: LogData): string {
  const time = new Date().toISOString().slice(11, 23);
  const payload = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  return `[${time}][agromoll:${scope}] ${message}${payload}`;
}

/**
 * Единый логгер мобильного приложения.
 *
 * Expo транслирует console.* в термиал/DevTools, поэтому структурируем вывод сами:
 * время, scope модуля и JSON-контекст. debug-уровень живёт только в dev-сборке.
 */
export const logger: Record<Level, (scope: LogScope, message: string, data?: LogData) => void> = {
  debug(scope, message, data) {
    if (isDev()) {
      console.debug(format(scope, message, data));
    }
  },
  info(scope, message, data) {
    console.info(format(scope, message, data));
  },
  warn(scope, message, data) {
    console.warn(format(scope, message, data));
  },
  error(scope, message, data) {
    console.error(format(scope, message, data));
  },
};
