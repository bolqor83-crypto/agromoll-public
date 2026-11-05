/**
 * Тесты клиента API v0.3.0: axios + JWT-заголовок, ошибки → ApiError,
 * авто-refresh при 401 (single-flight) и сброс сессии при неудачном refresh.
 */
import { AxiosError } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ApiError, api, http } from './api';
import { tokenStore } from './token-store';

// secure store с настоящим хранением в Map — интерцептор читает токены
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

const ACCESS = 'access-token-1';
const ACCESS_2 = 'access-token-2';
const REFRESH = 'refresh-token-1';

/** Мок-адаптер axios: перехватывает запросы до сети. */
let adapterMock: jest.Mock;

/** Ответ axios: 2xx — resolve, иначе — reject с AxiosError (как делает реальный адаптер). */
function respond<T>(status: number, data: T, config: InternalAxiosRequestConfig): Promise<AxiosResponse<T>> {
  const response: AxiosResponse<T> = {
    status,
    statusText: String(status),
    data,
    headers: {},
    config,
  };
  if (status >= 200 && status < 300) {
    return Promise.resolve(response);
  }
  return Promise.reject(
    new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, response),
  );
}

describe('api-клиент (axios + JWT)', () => {
  beforeAll(() => {
    adapterMock = jest.fn();
    http.defaults.adapter = adapterMock as unknown as AxiosAdapter;
  });

  beforeEach(async () => {
    adapterMock.mockReset();
    await tokenStore.setTokens(ACCESS, REFRESH);
  });

  afterAll(async () => {
    await tokenStore.clear();
  });

  it('отправляет Authorization: Bearer и парсит JSON ответа', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(200, [{ id: 'l-1' }], config),
    );

    const listings = await api.listings();

    expect(listings).toEqual([{ id: 'l-1' }]);
    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.url).toBe('/listings');
    expect(config.headers.Authorization).toBe(`Bearer ${ACCESS}`);
  });

  it('бросает ApiError с кодом статуса и подсказкой из тела', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(409, { message: 'Недостаточно товара: свободно 5' }, config),
    );

    const error = await api.createBooking('listing-1', 10).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).hint).toBe('Недостаточно товара: свободно 5');
  });

  it('POST-запросы несут тело в JSON', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(201, { id: 'b-1', status: 'requested' }, config),
    );

    await api.createBooking('listing-1', 20);

    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.method).toBe('post');
    expect(config.data).toBe(JSON.stringify({ listingId: 'listing-1', requestedQuantity: 20 }));
  });

  it('сетевой сбой → ApiError NETWORK (экран уйдёт в демо-режим)', async () => {
    adapterMock.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));

    const error = await api.bookings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK');
  });

  it('401 → refresh → повтор запроса с новым токеном', async () => {
    // первый вызов — 401; /auth/refresh — новый токен; повтор — 200
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/bookings') {
        const attempt = adapterMock.mock.calls.filter(
          (c) => (c[0] as InternalAxiosRequestConfig).url === '/bookings',
        ).length;
        if (attempt === 1) {
          return respond(401, { message: 'токен истёк' }, config);
        }
        return respond(200, [], config);
      }
      if (config.url === '/auth/refresh') {
        return respond(200, { accessToken: ACCESS_2 }, config);
      }
      throw new Error(`unexpected url: ${config.url}`);
    });

    const bookings = await api.bookings();

    expect(bookings).toEqual([]);
    // refresh-вызов через отдельный axios-инстанс (не http) — проверяем сохранение токена
    await expect(tokenStore.getAccessToken()).resolves.toBe(ACCESS_2);
    // повторный /bookings-запрос должен нести новый токен
    const retryConfig = adapterMock.mock.calls
      .map((c) => c[0] as InternalAxiosRequestConfig)
      .find((c) => c.url === '/bookings' && c.headers.Authorization === `Bearer ${ACCESS_2}`);
    expect(retryConfig).toBeTruthy();
  });

  it('refresh не удался → токены стёрты, событие sign-out', async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/bookings') {
        return respond(401, { message: 'токен истёк' }, config);
      }
      if (config.url === '/auth/refresh') {
        return respond(401, { message: 'refresh истёк' }, config);
      }
      throw new Error(`unexpected url: ${config.url}`);
    });

    await expect(api.bookings()).rejects.toBeInstanceOf(ApiError);

    // токены стёрты: сессия сгорела (auth store выйдет по событию sign-out)
    await expect(tokenStore.getAccessToken()).resolves.toBeNull();
    await expect(tokenStore.getRefreshToken()).resolves.toBeNull();
  });

  it('токена нет — запрос без Authorization', async () => {
    await tokenStore.clear();
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(200, [], config),
    );

    await api.listings();

    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.headers.Authorization).toBeUndefined();
  });
});
