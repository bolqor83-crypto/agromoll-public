import { describe, expect, it } from 'vitest';
import {
  BookingStatusSchema,
  CancelBookingSchema,
  CounterOfferSchema,
  CreateBookingSchema,
  CreateListingSchema,
  UpdateListingSchema,
  UserRoleSchema,
  apiEnvSchema,
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

  it('CancelBookingSchema — только необязательная причина', () => {
    expect(CancelBookingSchema.safeParse({}).success).toBe(true);
    expect(CancelBookingSchema.safeParse({ reason: 'не успел доехать' }).success).toBe(true);
    expect(CancelBookingSchema.safeParse({ other: true }).success).toBe(false);
  });

  it('BookingStatusSchema отклоняет неизвестный статус', () => {
    expect(BookingStatusSchema.safeParse('pending').success).toBe(false);
  });
});
