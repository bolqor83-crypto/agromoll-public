/**
 * Тесты маппинга ошибок (v0.6.1-D, ADR-026): ApiError-коды →
 * человеческие { title, description } для ErrorState, плюс полный
 * путь axios-ошибка → toApiError → errorContentFor.
 *
 * Здесь @/lib/api НЕ замокан: проверяем настоящий маппинг
 * (AxiosError с ответом/без ответа → NETWORK/SERVER/...).
 */
import { AxiosError } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { errorContentFor } from './error-content';
import { ApiError } from './api';

// token-store живёт на expo-secure-store — даём живой Map-мок.
jest.mock('expo-secure-store', () => {
  const storage = new Map<string, string>();
  return {
    getItemAsync: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItemAsync: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key: string) => {
      storage.delete(key);
      return Promise.resolve();
    },
  };
});

/** AxiosError с ответом (как реджектит реальный адаптер). */
function axiosErrorWithResponse(status: number): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = {
    status,
    statusText: String(status),
    data: { message: `серверное сообщение ${status}` },
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    null,
    response,
  );
}

/** AxiosError без ответа — сеть недоступна. */
function axiosNetworkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', {} as InternalAxiosRequestConfig);
}

describe('errorContentFor: код → человеческий текст', () => {
  it.each([
    ['NETWORK', 'Нет связи с сервером'],
    ['TIMEOUT', 'Сервер не отвечает'],
    ['INVALID_RESPONSE', 'Данные пришли в неожиданном виде'],
    ['RATE_LIMITED', 'Слишком часто'],
    ['SERVER', 'Сервер перегружен'],
    ['UNAUTHORIZED', 'Сессия истекла'],
    ['UNKNOWN', 'Не получилось загрузить'],
  ])('код %s → заголовок «%s»', (code, title) => {
    const content = errorContentFor(new ApiError('x', undefined, code as ApiError['code'], undefined));
    expect(content.title).toBe(title);
    // описание всегда непустое — ErrorState без пояснения бесполезен
    expect(content.description.length).toBeGreaterThan(10);
  });

  it('не-ApiError (например, строка) → UNKNOWN, не падает', () => {
    expect(errorContentFor('что-то сломалось').title).toBe('Не получилось загрузить');
    expect(errorContentFor(null).title).toBe('Не получилось загрузить');
  });
});

describe('errorContentFor: полный путь axios → текст (через настоящий toApiError)', () => {
  it('500 → SERVER: «Сервер перегружен»', () => {
    expect(errorContentFor(axiosErrorWithResponse(500)).title).toBe('Сервер перегружен');
  });

  it('503 → SERVER', () => {
    expect(errorContentFor(axiosErrorWithResponse(503)).title).toBe('Сервер перегружен');
  });

  it('429 → RATE_LIMITED', () => {
    expect(errorContentFor(axiosErrorWithResponse(429)).title).toBe('Слишком часто');
  });

  it('401 → UNAUTHORIZED', () => {
    expect(errorContentFor(axiosErrorWithResponse(401)).title).toBe('Сессия истекла');
  });

  it('сеть отвалилась (без ответа) → NETWORK', () => {
    expect(errorContentFor(axiosNetworkError()).title).toBe('Нет связи с сервером');
  });

  it('тексты NETWORK не пугают: обещают, что офлайн-действия сохранятся', () => {
    const content = errorContentFor(axiosNetworkError());
    expect(content.description).toMatch(/сохран/i);
  });
});
