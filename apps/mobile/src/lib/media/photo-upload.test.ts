/**
 * Тесты клиентского потока загрузки фото товара (v0.7.0-D, ADR-038):
 * паттерн доказательств споров (ADR-036) — счастливый путь S3
 * (presigned → PUT → confirm), деградация в fallback (503/S3 лежит →
 * data:-URL ≤ 500 КБ), честные ошибки. Ошибка фото не роняет лот —
 * это задача вызывающего кода (CreateListingModal), здесь проверяем
 * коды результатов.
 */
jest.mock('@/lib/api', () => ({
  api: {
    listingPhotoUploadUrl: jest.fn(),
    attachListingPhoto: jest.fn(),
  },
}));
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line import/first -- моки объявляются до модуля
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { uploadListingPhoto } from './photo-upload';

const mockApi = api as unknown as {
  listingPhotoUploadUrl: jest.Mock;
  attachListingPhoto: jest.Mock;
};

/** Сжатое фото (как из compressPhoto). */
function makePhoto(sizeBytes = 1000) {
  const bytes = new Uint8Array(sizeBytes);
  return {
    bytes,
    fileName: 'photo-1.jpg',
    mimeType: 'image/jpeg' as const,
    sizeBytes,
    previewUri: 'file:///cache/photo-1.jpg',
  };
}

describe('uploadListingPhoto (ADR-038): S3-путь и fallback', () => {
  beforeEach(() => {
    mockApi.listingPhotoUploadUrl.mockReset();
    mockApi.attachListingPhoto.mockReset();
    global.fetch = jest.fn();
  });

  it('счастливый путь: presigned → PUT → confirm с objectKey', async () => {
    mockApi.listingPhotoUploadUrl.mockResolvedValue({
      objectKey: 'listings/l-1/abc.jpg',
      uploadUrl: 'http://s3.local/bucket/listings/l-1/abc.jpg?sig=put',
      expiresIn: 600,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    mockApi.attachListingPhoto.mockResolvedValue({});

    const result = await uploadListingPhoto('l-1', makePhoto());

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://s3.local/bucket/listings/l-1/abc.jpg?sig=put',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(mockApi.attachListingPhoto).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({ storage: 's3', objectKey: 'listings/l-1/abc.jpg' }),
    );
  });

  it('хранилище не настроено (503) → fallback data:-URL ≤ 500 КБ', async () => {
    mockApi.listingPhotoUploadUrl.mockRejectedValue({ status: 503 });
    mockApi.attachListingPhoto.mockResolvedValue({});

    const result = await uploadListingPhoto('l-1', makePhoto(1000));

    expect(result).toEqual({ ok: true });
    expect(mockApi.attachListingPhoto).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({
        storage: 'data',
        dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      }),
    );
  });

  it('S3 PUT упал → fallback data:-URL', async () => {
    mockApi.listingPhotoUploadUrl.mockResolvedValue({
      objectKey: 'listings/l-1/abc.jpg',
      uploadUrl: 'http://s3.local/bucket/x?sig=put',
      expiresIn: 600,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    mockApi.attachListingPhoto.mockResolvedValue({});

    const result = await uploadListingPhoto('l-1', makePhoto());

    expect(result).toEqual({ ok: true });
    expect(mockApi.attachListingPhoto).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({ storage: 'data' }),
    );
  });

  it('фото больше 500 КБ и хранилище недоступно → честная ошибка', async () => {
    mockApi.listingPhotoUploadUrl.mockRejectedValue({ status: 503 });

    const result = await uploadListingPhoto('l-1', makePhoto(600 * 1024));

    expect(result).toEqual({ ok: false, error: 'too_large_for_fallback' });
    expect(mockApi.attachListingPhoto).not.toHaveBeenCalled();
  });

  it('confirm после успешного PUT упал → upload_failed, без дублирования', async () => {
    mockApi.listingPhotoUploadUrl.mockResolvedValue({
      objectKey: 'listings/l-1/abc.jpg',
      uploadUrl: 'http://s3.local/x?sig=put',
      expiresIn: 600,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    // Confirm падает: не уходим в fallback (файл УЖЕ в хранилище,
    // повторная загрузка data:-URL создала бы дубль фото).
    mockApi.attachListingPhoto.mockRejectedValue(new Error('confirm failed'));

    const result = await uploadListingPhoto('l-1', makePhoto());

    expect(result).toEqual({ ok: false, error: 'upload_failed' });
    // Ровно одна попытка confirm — fallback не зовём.
    expect(mockApi.attachListingPhoto).toHaveBeenCalledTimes(1);
  });

  it('fallback confirm тоже упал → network, без тихих потерь', async () => {
    mockApi.listingPhotoUploadUrl.mockRejectedValue({ status: 503 });
    mockApi.attachListingPhoto.mockRejectedValue(new Error('fallback failed'));

    const result = await uploadListingPhoto('l-1', makePhoto());

    expect(result).toEqual({ ok: false, error: 'network' });
  });
});
