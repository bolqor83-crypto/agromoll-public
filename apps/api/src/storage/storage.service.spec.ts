/**
 * Unit-тесты S3-хранилища (v0.7.0-B, ADR-036) — без сети.
 *
 * Сетевые сценарии (реальное S3-хранилище в CI: presign → PUT → HEAD
 * → presign GET)
 * покрывает e2e test/disputes.e2e-spec.ts в CI. Здесь — конфигурация из
 * env, генерация ключей, деградация при недоступном бакете и поведение
 * presign/head при сконфигурированном, но «лежащем» хранилище.
 */
import { S3Client } from '@aws-sdk/client-s3';
import { StorageService, type S3ClientFactory } from './storage.service';
import {
  DATA_URL_PREFIX,
  S3_URL_SCHEME,
  keyBelongsToDispute,
  keyBelongsToListing,
  s3KeyFromFileUrl,
} from './storage.constants';

const ENV = {
  S3_ENDPOINT: 'http://localhost:4566',
  S3_BUCKET: 'evidence',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
};

/** Фабрика-мок: send() управляется тестом (бросает/отвечает без сети). */
function fakeClientFactory(
  behaviour: 'head-ok' | 'all-error',
): { factory: S3ClientFactory; send: jest.Mock } {
  const send = jest.fn(async () => {
    if (behaviour === 'all-error') {
      throw new Error('network unreachable');
    }
    return {};
  });
  const client = { send } as unknown as S3Client;
  return { factory: () => client, send };
}

describe('StorageService (unit, v0.7.0-B)', () => {
  it('без конфига S3_* — не настроен, приложение живёт с fallback', async () => {
    const service = new StorageService();
    await service.configureFromEnv({});
    expect(service.isConfigured()).toBe(false);
    expect(service.isAvailable()).toBe(false);
  });

  it('частичный конфиг (нет ключей) — тоже не настроен', async () => {
    const service = new StorageService();
    await service.configureFromEnv({ S3_BUCKET: 'evidence' });
    expect(service.isConfigured()).toBe(false);
  });

  it('бакет отвечает — доступен', async () => {
    const service = new StorageService();
    const { factory } = fakeClientFactory('head-ok');
    await service.configureFromEnv(ENV, factory);
    expect(service.isConfigured()).toBe(true);
    expect(service.isAvailable()).toBe(true);
  });

  it('хранилище лежит (HeadBucket и CreateBucket падают) — деградация, не падение', async () => {
    const service = new StorageService();
    const { factory } = fakeClientFactory('all-error');
    await service.configureFromEnv(ENV, factory);
    expect(service.isConfigured()).toBe(false);
    expect(service.isAvailable()).toBe(false);
  });

  it('ключ доказательства: disputes/<id>/<uuid>.<ext> — принадлежность проверяема', () => {
    const service = new StorageService();
    const key = service.evidenceObjectKey('0e0d9d8e-1111-4222-8333-444455556666', 'image/jpeg');
    expect(key).toMatch(/^disputes\/0e0d9d8e-1111-4222-8333-444455556666\/[\w-]+\.jpg$/);
    expect(keyBelongsToDispute(key, '0e0d9d8e-1111-4222-8333-444455556666')).toBe(true);
    expect(keyBelongsToDispute(key, 'another-dispute-id')).toBe(false);
  });

  it('ключ фото товара (v0.7.0-D): listings/<id>/<uuid>.<ext> — изоляция лотов', () => {
    const service = new StorageService();
    const key = service.listingPhotoObjectKey('0e0d9d8e-1111-4222-8333-444455556666', 'image/png');
    expect(key).toMatch(/^listings\/0e0d9d8e-1111-4222-8333-444455556666\/[\w-]+\.png$/);
    expect(keyBelongsToListing(key, '0e0d9d8e-1111-4222-8333-444455556666')).toBe(true);
    expect(keyBelongsToListing(key, 'another-listing-id')).toBe(false);
    // Ключ доказательства спора не выдаётся за ключ фото — префиксы разные.
    expect(keyBelongsToListing(`disputes/0e0d9d8e-1111-4222-8333-444455556666/x.jpg`, '0e0d9d8e-1111-4222-8333-444455556666')).toBe(false);
    expect(keyBelongsToDispute(service.listingPhotoObjectKey('0e0d9d8e-1111-4222-8333-444455556666', 'image/jpeg'), '0e0d9d8e-1111-4222-8333-444455556666')).toBe(false);
  });

  it('fileUrl-хелперы: s3:// и data: различаются', () => {
    expect(s3KeyFromFileUrl('s3://disputes/x/y.jpg')).toBe('disputes/x/y.jpg');
    expect(s3KeyFromFileUrl('data:image/jpeg;base64,abc')).toBeNull();
    expect(s3KeyFromFileUrl(S3_URL_SCHEME)).toBeNull();
    expect('data:image/jpeg;base64,abc'.startsWith(DATA_URL_PREFIX)).toBe(true);
  });

  it('presign/head без инициализации — понятная ошибка, а не падение SDK', async () => {
    const service = new StorageService();
    await expect(service.presignPut('k', 'image/jpeg')).rejects.toThrow('S3');
    await expect(service.headObject('k')).rejects.toThrow('S3');
  });
});
