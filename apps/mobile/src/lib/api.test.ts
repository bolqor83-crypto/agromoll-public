/**
 * Тесты тонкого клиента API: заголовки, таймаут-контроллер, ошибки.
 */
import { ApiError, api } from './api';

const USER = '00000000-0000-4000-8000-000000000001';

describe('api-клиент', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('отправляет X-User-Id и парсит JSON ответа', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'l-1' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const listings = await api.listings(USER);

    expect(listings).toEqual([{ id: 'l-1' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/listings');
    expect((init.headers as Record<string, string>)['X-User-Id']).toBe(USER);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('бросает ApiError с кодом статуса и подсказкой из тела', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Недостаточно товара: свободно 5' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const error = await api.createBooking(USER, 'listing-1', 10).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).hint).toBe('Недостаточно товара: свободно 5');
  });

  it('POST-запросы несут тело в JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'b-1', status: 'requested' }), { status: 201 }),
    );

    await api.createBooking(USER, 'listing-1', 20);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      listingId: 'listing-1',
      requestedQuantity: 20,
    });
  });

  it('сетевой сбой прокидывается как ошибка (экран уйдёт в демо-режим)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api.bookings(USER)).rejects.toThrow();
  });
});
