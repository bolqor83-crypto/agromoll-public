/**
 * Тесты конфигурации API URL (v0.6.1-0, ADR-022):
 * dev-фолбэк на localhost, в prod фолбэка нет — null.
 *
 * Важно о механике Expo: babel-preset-expo инлайнит ссылки
 * process.env.EXPO_PUBLIC_* ЗНАЧЕНИЕМ на момент трансформации файла
 * (см. babel-preset-expo/build/inline-env-vars.js). Поэтому «env задан →
 * адрес в бандле» здесь не тестируется подменой process.env — этот
 * сценарий покрыт чистой функцией (ниже) и smoke-сборкой
 * `EXPO_PUBLIC_API_URL=... expo export` с проверкой бандла (ADR-022).
 */
import { API_URL, DEV_FALLBACK_URL, IS_API_CONFIGURED, resolveApiUrl } from './api-config';

describe('resolveApiUrl (чистая функция)', () => {
  it('использует заданный адрес — и в dev, и в prod', () => {
    expect(resolveApiUrl({ url: 'https://api.example.com', isDev: false })).toBe(
      'https://api.example.com',
    );
    expect(resolveApiUrl({ url: 'https://api.example.com', isDev: true })).toBe(
      'https://api.example.com',
    );
  });

  it('срезает хвостовые слэши — эндпоинты начинаются с «/»', () => {
    expect(resolveApiUrl({ url: 'https://api.example.com///', isDev: false })).toBe(
      'https://api.example.com',
    );
  });

  it('игнорирует адрес из одних пробелов', () => {
    expect(resolveApiUrl({ url: '   ', isDev: false })).toBeNull();
  });

  it('в dev без переменной — фолбэк на localhost', () => {
    expect(resolveApiUrl({ url: undefined, isDev: true })).toBe(DEV_FALLBACK_URL);
    expect(resolveApiUrl({ url: undefined, isDev: true })).toBe('http://localhost:3000');
  });

  it('в prod без переменной — null, фолбэка НЕТ (ADR-022)', () => {
    expect(resolveApiUrl({ url: undefined, isDev: false })).toBeNull();
    expect(resolveApiUrl({ url: '', isDev: false })).toBeNull();
  });
});

/** Пере-испорт модуля с подменённым __DEV__ (env-инлайн уже вшит — не трогаем). */
function freshModuleWithDev(isDev: boolean): typeof import('./api-config') {
  const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  (globalThis as { __DEV__?: boolean }).__DEV__ = isDev;
  let mod: typeof import('./api-config') | undefined;
  jest.isolateModules(() => {
    mod = require('./api-config');
  });
  (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
  return mod!;
}

describe('модульные константы (вычислены при импорте)', () => {
  // Тесты запускаются без EXPO_PUBLIC_API_URL (инлайн на трансформации
  // дал undefined — как в prod-сборке без переменной, ADR-022).
  it('в dev без переменной — localhost-фолбэк, адрес настроен', () => {
    expect(API_URL).toBe(DEV_FALLBACK_URL);
    expect(IS_API_CONFIGURED).toBe(true);
    expect(freshModuleWithDev(true).API_URL).toBe(DEV_FALLBACK_URL);
    expect(freshModuleWithDev(true).IS_API_CONFIGURED).toBe(true);
  });

  it('в prod (__DEV__ = false) без переменной — null: фолбэка нет (хотфикс прода)', () => {
    const fresh = freshModuleWithDev(false);
    expect(fresh.API_URL).toBeNull();
    expect(fresh.IS_API_CONFIGURED).toBe(false);
  });
});
