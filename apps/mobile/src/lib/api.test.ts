/**
 * Тесты клиента API v0.3.0: axios + JWT-заголовок, ошибки → ApiError,
 * авто-refresh при 401 (single-flight) и сброс сессии при неудачном refresh.
 */
import { AxiosError } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ApiError, api, getLastSignOutReason, http } from './api';
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
function respond<T>(
  status: number,
  data: T,
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse<T>> {
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
    new AxiosError(
      `Request failed with status code ${status}`,
      'ERR_BAD_REQUEST',
      config,
      null,
      response,
    ),
  );
}

/** Полный валидный ListingDto — мок ответа, проходящий zod-валидацию. */
const VALID_LISTING = {
  id: 'l-1',
  sellerId: 'u-1',
  sellerName: 'ФХ «Донская долина»',
  title: 'Помидоры розовые',
  category: 'vegetables',
  unit: 'kg',
  pricePerUnit: '85.50',
  quantityAvailable: 100,
  quantityReserved: 0,
  quantityAvailableForBooking: 100,
  lineNumber: 12,
  isPerishable: true,
  status: 'active',
  createdAt: '2026-11-05T06:00:00.000Z',
  updatedAt: '2026-11-05T06:00:00.000Z',
};

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
      respond(200, [VALID_LISTING], config),
    );

    const listings = await api.listings();

    expect(listings).toEqual([VALID_LISTING]);
    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.url).toBe('/listings');
    expect(config.headers.Authorization).toBe(`Bearer ${ACCESS}`);
  });

  it('бросает ApiError с кодом статуса и подсказкой из тела', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(409, { message: 'Недостаточно товара: свободно 5' }, config),
    );

    const error = await api
      .createListing({
        title: 'Лук репчатый',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 30,
        quantityAvailable: 10,
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).hint).toBe('Недостаточно товара: свободно 5');
  });

  it('POST-запросы несут тело в JSON', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(201, VALID_LISTING, config),
    );

    await api.createListing({
      title: 'Лук репчатый',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: 30,
      quantityAvailable: 10,
    });

    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.method).toBe('post');
    expect(config.data).toBe(
      JSON.stringify({
        title: 'Лук репчатый',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 30,
        quantityAvailable: 10,
      }),
    );
  });

  it('сетевой сбой → ApiError NETWORK (экран уйдёт в демо-режим)', async () => {
    adapterMock.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));

    const error = await api.bookings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK');
  });

  it('401 → refresh (ротация) → повтор запроса с новой парой токенов', async () => {
    // первый вызов — 401; /auth/refresh — новая ПАРА; повтор — 200
    const REFRESH_2 = 'refresh-token-2';
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
        return respond(200, { accessToken: ACCESS_2, refreshToken: REFRESH_2 }, config);
      }
      throw new Error(`unexpected url: ${config.url}`);
    });

    const bookings = await api.bookings();

    expect(bookings).toEqual([]);
    // v0.3.1: ротация — сохраняем ОБА токена
    await expect(tokenStore.getAccessToken()).resolves.toBe(ACCESS_2);
    await expect(tokenStore.getRefreshToken()).resolves.toBe(REFRESH_2);
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
    expect(getLastSignOutReason()).toBe('expired');
  });

  it('v0.3.1: 401 TOKEN_REUSE_DETECTED → выход с причиной reuse (мягкий сценарий кражи)', async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/bookings') {
        return respond(401, { message: 'токен истёк' }, config);
      }
      if (config.url === '/auth/refresh') {
        // сервер обнаружил повторное использование: семья отозвана
        return respond(
          401,
          {
            statusCode: 401,
            message: 'Сессия завершена. Войдите снова',
            code: 'TOKEN_REUSE_DETECTED',
          },
          config,
        );
      }
      throw new Error(`unexpected url: ${config.url}`);
    });

    await expect(api.bookings()).rejects.toBeInstanceOf(ApiError);

    await expect(tokenStore.getAccessToken()).resolves.toBeNull();
    await expect(tokenStore.getRefreshToken()).resolves.toBeNull();
    // причина — reuse: auth-store покажет «Сессия завершена. Войдите снова»
    expect(getLastSignOutReason()).toBe('reuse');
  });

  it('v0.3.1: logout уходит на сервер с парой токенов и не бросает ошибок', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(204, '', config),
    );

    await expect(api.logout(REFRESH, ACCESS)).resolves.toBeUndefined();

    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.url).toBe('/auth/logout');
    expect(config.method).toBe('post');
    expect(JSON.parse(config.data as string)).toEqual({
      refreshToken: REFRESH,
      accessToken: ACCESS,
    });
  });

  it('v0.3.1: сбой сети при logout не блокирует локальный выход', async () => {
    adapterMock.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));

    await expect(api.logout(REFRESH)).resolves.toBeUndefined();
  });

  it('невалидный ответ API → ApiError INVALID_RESPONSE (zod-валидация)', async () => {
    // сервер «испортил» лот: цена числом вместо строки
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(200, [{ id: 'l-1', pricePerUnit: 85.5 }], config),
    );

    const error = await api.listings().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INVALID_RESPONSE');
  });

  it('валидный ответ проходит zod-валидацию без изменений', async () => {
    adapterMock.mockImplementationOnce((config: InternalAxiosRequestConfig) =>
      respond(
        200,
        [
          {
            id: 'l-1',
            sellerId: 'u-1',
            title: 'Помидоры',
            category: 'vegetables',
            unit: 'kg',
            pricePerUnit: '85.50',
            quantityAvailable: 100,
            quantityReserved: 0,
            quantityAvailableForBooking: 100,
            lineNumber: null,
            isPerishable: true,
            status: 'active',
            createdAt: '2026-11-05T06:00:00.000Z',
            updatedAt: '2026-11-05T06:00:00.000Z',
          },
        ],
        config,
      ),
    );

    const listings = await api.listings();
    expect(listings).toHaveLength(1);
    expect(listings[0].title).toBe('Помидоры');
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
