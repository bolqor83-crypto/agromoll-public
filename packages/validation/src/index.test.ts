import { describe, expect, it } from 'vitest';
import {
  apiEnvSchema,
  AuthResponseSchema,
  BookingResponseSchema,
  BookingsResponseSchema,
  BookingStatusSchema,
  CancelBookingSchema,
  CounterOfferSchema,
  CreateBookingSchema,
  CreateDebtSchema,
  CreateListingSchema,
  DebtResponseSchema,
  ErrorResponseSchema,
  ListingResponseSchema,
  ListingsResponseSchema,
  RefreshResponseSchema,
  RequestCodeResponseSchema,
  UpdateListingSchema,
  UserResponseSchema,
  UserRoleSchema,
  DisputeEvidenceSchema,
  DisputeMessageSchema,
  DISPUTE_EVIDENCE_MAX_BYTES,
  OpenDisputeSchema,
  ResolveDisputeSchema,
  UpdateRoleSchema,
  AppealDetailResponseSchema,
  AppealResponseSchema,
  OpenAppealSchema,
  ResolveAppealSchema,
} from './index';

describe('@agromoll/validation', () => {
  it('UserRoleSchema принимает все роли рынка', () => {
    for (const role of ['buyer', 'seller', 'driver'] as const) {
      expect(UserRoleSchema.parse(role)).toBe(role);
    }
  });

  it('UserRoleSchema отклоняет неизвестную роль', () => {
    expect(UserRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('apiEnvSchema подставляет дефолты и конвертирует порт', () => {
    const env = apiEnvSchema.parse({
      API_PORT: '4000',
      DATABASE_URL: 'postgresql://localhost:5432/agromoll',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.BOOKING_TTL_MINUTES).toBe(30);
  });

  it('apiEnvSchema требует DATABASE_URL', () => {
    expect(apiEnvSchema.safeParse({}).success).toBe(false);
  });

  it('apiEnvSchema конвертирует BOOKING_TTL_MINUTES из строки', () => {
    const env = apiEnvSchema.parse({
      DATABASE_URL: 'postgresql://localhost:5432/agromoll',
      BOOKING_TTL_MINUTES: '10',
    });
    expect(env.BOOKING_TTL_MINUTES).toBe(10);
  });

  it('CreateListingSchema принимает валидный лот', () => {
    const parsed = CreateListingSchema.parse({
      title: 'Помидоры розовые',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: '85.50',
      quantityAvailable: 120,
      lineNumber: 12,
    });
    expect(parsed.pricePerUnit).toBe(85.5);
    expect(parsed.isPerishable).toBe(false);
  });

  it('CreateListingSchema отклоняет нулевую цену и количество', () => {
    const base = { title: 'Лук', category: 'vegetables', unit: 'kg' };
    expect(
      CreateListingSchema.safeParse({ ...base, pricePerUnit: 0, quantityAvailable: 10 }).success,
    ).toBe(false);
    expect(
      CreateListingSchema.safeParse({ ...base, pricePerUnit: 10, quantityAvailable: 0 }).success,
    ).toBe(false);
  });

  it('UpdateListingSchema допускает частичное обновление, но не пустое', () => {
    expect(UpdateListingSchema.safeParse({ status: 'paused' }).success).toBe(true);
    expect(UpdateListingSchema.safeParse({}).success).toBe(false);
    expect(UpdateListingSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('CreateBookingSchema требует положительное количество и uuid листинга', () => {
    expect(
      CreateBookingSchema.safeParse({ listingId: 'not-uuid', requestedQuantity: 5 }).success,
    ).toBe(false);
    expect(
      CreateBookingSchema.safeParse({
        listingId: '5f8d3f3a-2b4e-4f6a-9c1d-111111111111',
        requestedQuantity: 0,
      }).success,
    ).toBe(false);
    expect(
      CreateBookingSchema.parse({
        listingId: '5f8d3f3a-2b4e-4f6a-9c1d-111111111111',
        requestedQuantity: '15',
      }).requestedQuantity,
    ).toBe(15);
  });

  it('CounterOfferSchema требует хотя бы одно предложение', () => {
    expect(CounterOfferSchema.safeParse({}).success).toBe(false);
    expect(CounterOfferSchema.safeParse({ offeredQuantity: 8 }).success).toBe(true);
    expect(CounterOfferSchema.safeParse({ pickupTime: 'после 9:00' }).success).toBe(true);
  });

  it('CancelBookingSchema — только необязательная причина; лишние ключи стрипаются', () => {
    expect(CancelBookingSchema.safeParse({}).success).toBe(true);
    expect(CancelBookingSchema.safeParse({ reason: 'не успел доехать' }).success).toBe(true);
    // Мобильный outbox шлёт весь payload операции: { bookingId, reason }.
    // bookingId живёт в URL — сервер его просто выкидывает (не strict,
    // v0.4.0: strict ломал отмену с реального клиента 400-й).
    const withBookingId = CancelBookingSchema.safeParse({
      bookingId: 'b-1',
      reason: 'не успел доехать',
    });
    expect(withBookingId.success).toBe(true);
    if (withBookingId.success) {
      expect(withBookingId.data).toEqual({ reason: 'не успел доехать' });
    }
    // Слишком длинная причина — по-прежнему ошибка.
    expect(CancelBookingSchema.safeParse({ reason: 'а'.repeat(501) }).success).toBe(false);
  });

  it('BookingStatusSchema отклоняет неизвестный статус', () => {
    expect(BookingStatusSchema.safeParse('pending').success).toBe(false);
  });

  describe('CreateDebtSchema (v0.4.0)', () => {
    const debtorId = '5f8d3f3a-2b4e-4f6a-9c1d-222222222222';

    it('принимает валидное тело и подставляет RUB по умолчанию', () => {
      const parsed = CreateDebtSchema.safeParse({ debtorId, amount: 12500 });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.currency).toBe('RUB');
        expect(parsed.data.amount).toBe(12500);
      }
    });

    it('сумма — строкой тоже проходит (coerce), границы и копейки — нет', () => {
      expect(CreateDebtSchema.safeParse({ debtorId, amount: '4200.50' }).success).toBe(true);
      expect(CreateDebtSchema.safeParse({ debtorId, amount: 0 }).success).toBe(false);
      expect(CreateDebtSchema.safeParse({ debtorId, amount: -5 }).success).toBe(false);
      expect(CreateDebtSchema.safeParse({ debtorId, amount: 1_000_001 }).success).toBe(false);
      expect(CreateDebtSchema.safeParse({ debtorId, amount: 100.123 }).success).toBe(false);
    });

    it('валюта — только RUB; мусорные ключи — 400 (strict)', () => {
      expect(CreateDebtSchema.safeParse({ debtorId, amount: 100, currency: 'USD' }).success).toBe(
        false,
      );
      expect(CreateDebtSchema.safeParse({ debtorId, amount: 100, unknownField: 1 }).success).toBe(
        false,
      );
      expect(
        CreateDebtSchema.safeParse({ debtorId, amount: 100, listingId: 'не-uuid' }).success,
      ).toBe(false);
    });
  });

  it('DebtResponseSchema принимает валидный долг (v0.4.0)', () => {
    const debt = {
      id: 'debt-1',
      creditorId: 'u-1',
      creditorName: 'ФХ «Донская долина»',
      debtorId: 'u-2',
      debtorName: 'Ларёк «У Ашота»',
      amount: '12500.00',
      currency: 'RUB',
      description: null,
      listingId: null,
      bookingId: null,
      status: 'active',
      isOverdue: false,
      canRemind: true,
      nextReminderAt: null,
      resolveRequestedById: null,
      createdAt: '2026-11-07T06:00:00.000Z',
      updatedAt: '2026-11-07T06:00:00.000Z',
      settledAt: null,
    };
    expect(DebtResponseSchema.safeParse(debt).success).toBe(true);
    expect(DebtResponseSchema.safeParse({ ...debt, amount: 12500 }).success).toBe(false);
  });

  describe('схемы ответов API (v0.3.0)', () => {
    const listing = {
      id: 'l-1',
      sellerId: 'u-1',
      sellerName: 'ФХ «Донская долина»',
      title: 'Помидоры розовые',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: '85.50',
      quantityAvailable: 120,
      quantityReserved: 30,
      quantityAvailableForBooking: 90,
      lineNumber: 12,
      isPerishable: true,
      status: 'active',
      createdAt: '2026-11-05T06:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
    };

    it('ListingResponseSchema принимает валидный лот', () => {
      expect(ListingResponseSchema.safeParse(listing).success).toBe(true);
      expect(ListingsResponseSchema.safeParse([listing]).success).toBe(true);
    });

    it('ListingResponseSchema: лишние поля не ломают (passthrough)', () => {
      expect(ListingResponseSchema.safeParse({ ...listing, newServerField: 42 }).success).toBe(
        true,
      );
    });

    it('ListingResponseSchema отвергает число вместо строки цены', () => {
      expect(ListingResponseSchema.safeParse({ ...listing, pricePerUnit: 85.5 }).success).toBe(
        false,
      );
    });

    it('ListingResponseSchema отвергает мусорный статус', () => {
      expect(ListingResponseSchema.safeParse({ ...listing, status: 'hot' }).success).toBe(false);
    });

    const booking = {
      id: 'b-1',
      listingId: 'l-1',
      listingTitle: 'Помидоры розовые',
      listingUnit: 'kg',
      buyerId: 'u-2',
      buyerName: 'Ларёк «У Ашота»',
      requestedQuantity: 20,
      confirmedQuantity: null,
      status: 'requested',
      expiresAt: '2026-11-05T13:00:00.000Z',
      confirmedAt: null,
      deliveryConfirmedAt: null,
      receivedQuantity: null,
      qualityNotes: null,
      qualityFlag: 'ok',
      createdAt: '2026-11-05T12:30:00.000Z',
      updatedAt: '2026-11-05T12:30:00.000Z',
    };

    it('BookingResponseSchema принимает валидную бронь (confirmedQuantity nullable)', () => {
      expect(BookingResponseSchema.safeParse(booking).success).toBe(true);
      expect(
        BookingResponseSchema.safeParse({ ...booking, confirmedQuantity: 15, status: 'confirmed' })
          .success,
      ).toBe(true);
      expect(BookingsResponseSchema.safeParse([booking, booking]).success).toBe(true);
    });

    it('BookingResponseSchema отвергает число вместо nullable', () => {
      expect(BookingResponseSchema.safeParse({ ...booking, confirmedQuantity: '15' }).success).toBe(
        false,
      );
    });

    const user = {
      id: 'u-1',
      role: 'buyer',
      displayName: 'Ларёк «У Ашота»',
      phone: '+79611234567',
      phoneVerified: true,
      totalConfirmations: 3,
      totalDisputes: 0,
      createdAt: '2026-11-05T06:00:00.000Z',
    };

    it('UserResponseSchema и AuthResponseSchema', () => {
      expect(UserResponseSchema.safeParse(user).success).toBe(true);
      expect(UserResponseSchema.safeParse({ ...user, phone: null }).success).toBe(true);
      expect(
        AuthResponseSchema.safeParse({
          accessToken: 'access',
          refreshToken: 'refresh',
          user,
        }).success,
      ).toBe(true);
      expect(AuthResponseSchema.safeParse({ accessToken: 'access', user }).success).toBe(false); // без refreshToken
    });

    it('RefreshResponseSchema и RequestCodeResponseSchema', () => {
      // v0.3.1: refresh возвращает ПАРУ токенов (ротация)
      expect(RefreshResponseSchema.safeParse({ accessToken: 'a', refreshToken: 'r' }).success).toBe(
        true,
      );
      expect(RefreshResponseSchema.safeParse({ accessToken: 'a' }).success).toBe(false);
      expect(RefreshResponseSchema.safeParse({}).success).toBe(false);
      expect(RequestCodeResponseSchema.safeParse({ expiresInSec: 300 }).success).toBe(true);
    });

    it('ErrorResponseSchema: message строкой и массивом', () => {
      expect(ErrorResponseSchema.safeParse({ statusCode: 409, message: 'конфликт' }).success).toBe(
        true,
      );
      expect(
        ErrorResponseSchema.safeParse({
          statusCode: 400,
          message: ['поле 1', 'поле 2'],
          code: 'IDEMPOTENCY_IN_PROGRESS',
        }).success,
      ).toBe(true);
    });
  });

  describe('арбитраж споров (v0.6.0-C, ADR-033)', () => {
    const baseOpen = {
      type: 'booking',
      referenceId: '4f2e6c1a-7b3d-4e5f-9a01-2c3d4e5f6a7b',
      reason: 'Товар не соответствовал заказу',
    };

    it('OpenDisputeSchema: форма открытия спора', () => {
      expect(OpenDisputeSchema.safeParse(baseOpen).success).toBe(true);
      // Причина короче 10 символов — не пишем в арбитраж односложные жалобы
      expect(OpenDisputeSchema.safeParse({ ...baseOpen, reason: 'мало' }).success).toBe(false);
      expect(OpenDisputeSchema.safeParse({ ...baseOpen, referenceId: 'not-uuid' }).success).toBe(
        false,
      );
      expect(OpenDisputeSchema.safeParse({ ...baseOpen, type: 'listing' }).success).toBe(false);
      expect(OpenDisputeSchema.safeParse({ ...baseOpen, extra: 1 }).success).toBe(false);
    });

    it('DisputeMessageSchema: тело + isInternal по умолчанию false', () => {
      const parsed = DisputeMessageSchema.parse({ body: 'Прикладываю фото' });
      expect(parsed.isInternal).toBe(false);
      expect(DisputeMessageSchema.safeParse({ body: '' }).success).toBe(false);
      expect(DisputeMessageSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
    });

    it('DisputeEvidenceSchema: base64 ≤ 2 МБ', () => {
      const ok = { fileName: 'photo.jpg', mimeType: 'image/jpeg', dataBase64: 'aGVsbG8gd29ybGQ=' };
      expect(DisputeEvidenceSchema.safeParse(ok).success).toBe(true);
      // base64-строка длиннее лимита ~2.8 млн символов — файл > 2 МБ
      const huge = { ...ok, dataBase64: 'A'.repeat(DISPUTE_EVIDENCE_MAX_BYTES * 2) };
      expect(DisputeEvidenceSchema.safeParse(huge).success).toBe(false);
      expect(DisputeEvidenceSchema.safeParse({ ...ok, mimeType: 'не-mime' }).success).toBe(false);
    });

    it('ResolveDisputeSchema: решения и судьба объекта', () => {
      // Компромисс по долгу с уменьшенной суммой
      expect(
        ResolveDisputeSchema.safeParse({
          outcome: 'compromise',
          debtOutcome: 'settle_adjusted',
          adjustedAmount: 5000,
        }).success,
      ).toBe(true);
      // settle_adjusted без суммы — нельзя
      expect(
        ResolveDisputeSchema.safeParse({ outcome: 'compromise', debtOutcome: 'settle_adjusted' })
          .success,
      ).toBe(false);
      // adjustedAmount без settle_adjusted — нельзя
      expect(
        ResolveDisputeSchema.safeParse({
          outcome: 'favor_buyer',
          debtOutcome: 'cancel',
          adjustedAmount: 100,
        }).success,
      ).toBe(false);
      // no_fault с судьбой объекта — нельзя (объект размораживается как есть)
      expect(
        ResolveDisputeSchema.safeParse({ outcome: 'no_fault', bookingOutcome: 'cancel' }).success,
      ).toBe(false);
      // dismiss без всего — можно
      expect(ResolveDisputeSchema.safeParse({ outcome: 'dismiss' }).success).toBe(true);
    });

    it('UpdateRoleSchema: арбитром стать нельзя (ADR-033)', () => {
      expect(UpdateRoleSchema.safeParse({ role: 'buyer' }).success).toBe(true);
      expect(UpdateRoleSchema.safeParse({ role: 'seller' }).success).toBe(true);
      expect(UpdateRoleSchema.safeParse({ role: 'driver' }).success).toBe(true);
      // Самоназначение арбитром — конфликт интересов
      expect(UpdateRoleSchema.safeParse({ role: 'arbitrator' }).success).toBe(false);
    });
  });

  describe('апелляции на блокировки 289-ФЗ (v0.6.0-E, ADR-035)', () => {
    const baseOpen = {
      blockedPairId: '4f2e6c1a-7b3d-4e5f-9a01-2c3d4e5f6a7b',
      reason: 'Часы считались неверно: смены закрывались дважды',
    };

    it('OpenAppealSchema: форма открытия апелляции', () => {
      expect(OpenAppealSchema.safeParse(baseOpen).success).toBe(true);
      // Суть короче 10 символов — не пишем односложные жалобы
      expect(OpenAppealSchema.safeParse({ ...baseOpen, reason: 'мало' }).success).toBe(false);
      expect(OpenAppealSchema.safeParse({ ...baseOpen, blockedPairId: 'not-uuid' }).success).toBe(
        false,
      );
      // Лишние поля запрещены (strict)
      expect(OpenAppealSchema.safeParse({ ...baseOpen, extra: 1 }).success).toBe(false);
    });

    it('ResolveAppealSchema: решение арбитра', () => {
      expect(ResolveAppealSchema.safeParse({ decision: 'unblock' }).success).toBe(true);
      expect(
        ResolveAppealSchema.safeParse({ decision: 'reject', notes: 'Серия действительно закрыта' })
          .success,
      ).toBe(true);
      // Неизвестное решение и лишние поля — нельзя
      expect(ResolveAppealSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
      expect(ResolveAppealSchema.safeParse({ decision: 'unblock', extra: 1 }).success).toBe(false);
    });

    it('AppealResponseSchema/Detail: статусы и история месяцев', () => {
      const party = { id: 'u-1', displayName: 'Иван', role: 'driver' } as const;
      const base = {
        id: 'a-1',
        blockedPairId: 'b-1',
        driver: party,
        seller: { id: 'u-2', displayName: 'Мария', role: 'seller' } as const,
        appellant: party,
        reason: 'Часы задвоились',
        status: 'open',
        openedAt: '2026-11-10T10:00:00.000Z',
        assignedTo: null,
        assignedAt: null,
        resolvedAt: null,
        notes: null,
      };
      expect(AppealResponseSchema.safeParse(base).success).toBe(true);
      // Неизвестный статус — нельзя
      expect(AppealResponseSchema.safeParse({ ...base, status: 'closed' }).success).toBe(false);
      // Детали с месяцами часов — доказательство арбитра
      expect(
        AppealDetailResponseSchema.safeParse({
          ...base,
          months: [{ month: '2026-11', totalMinutes: 3600, monthCounted: true }],
        }).success,
      ).toBe(true);
      expect(
        AppealDetailResponseSchema.safeParse({
          ...base,
          months: [{ month: '2026-1', totalMinutes: 3600, monthCounted: true }],
        }).success,
      ).toBe(false);
    });
  });
});
