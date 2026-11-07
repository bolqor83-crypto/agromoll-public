/**
 * Тесты клиентского потока загрузки доказательств (v0.7.0-B, ADR-036):
 * счастливый путь S3 (presigned → PUT → confirm), деградация в
 * fallback (503/S3 лежит → data:-URL ≤ 500 КБ), честные ошибки.
 */
jest.mock('@/lib/api', () => ({
  api: {
    disputeEvidenceUploadUrl: jest.fn(),
    attachDisputeEvidence: jest.fn(),
  },
}));
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line import/first -- моки объявляются до модуля
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { uploadDisputeEvidence } from './evidence-upload';
// eslint-disable-next-line import/first
import { bytesToDataUrl } from './photo';

const mockApi = api as unknown as {
  disputeEvidenceUploadUrl: jest.Mock;
  attachDisputeEvidence: jest.Mock;
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

describe('uploadDisputeEvidence (ADR-036): S3-путь и fallback', () => {
  beforeEach(() => {
    mockApi.disputeEvidenceUploadUrl.mockReset();
    mockApi.attachDisputeEvidence.mockReset();
    global.fetch = jest.fn();
  });

  it('счастливый путь: presigned → PUT → confirm с objectKey', async () => {
    mockApi.disputeEvidenceUploadUrl.mockResolvedValue({
      objectKey: 'disputes/d-1/abc.jpg',
      uploadUrl: 'http://minio.local/bucket/disputes/d-1/abc.jpg?sig=put',
      expiresIn: 600,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    mockApi.attachDisputeEvidence.mockResolvedValue({});

    const result = await uploadDisputeEvidence('d-1', makePhoto());

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://minio.local/bucket/disputes/d-1/abc.jpg?sig=put',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(mockApi.attachDisputeEvidence).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ storage: 's3', objectKey: 'disputes/d-1/abc.jpg' }),
    );
  });

  it('хранилище не настроено (503) → fallback data:-URL ≤ 500 КБ', async () => {
    mockApi.disputeEvidenceUploadUrl.mockRejectedValue({ status: 503 });
    mockApi.attachDisputeEvidence.mockResolvedValue({});

    const photo = makePhoto(1000);
    const result = await uploadDisputeEvidence('d-1', photo);

    expect(result).toEqual({ ok: true });
    expect(mockApi.attachDisputeEvidence).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({
        storage: 'data',
        dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      }),
    );
  });

  it('S3 PUT упал → fallback data:-URL', async () => {
    mockApi.disputeEvidenceUploadUrl.mockResolvedValue({
      objectKey: 'disputes/d-1/abc.jpg',
      uploadUrl: 'http://minio.local/bucket/x?sig=put',
      expiresIn: 600,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    mockApi.attachDisputeEvidence.mockResolvedValue({});

    const result = await uploadDisputeEvidence('d-1', makePhoto());

    expect(result).toEqual({ ok: true });
    expect(mockApi.attachDisputeEvidence).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ storage: 'data' }),
    );
  });

  it('фото больше 500 КБ и хранилище недоступно → честная ошибка', async () => {
    mockApi.disputeEvidenceUploadUrl.mockRejectedValue({ status: 503 });

    const result = await uploadDisputeEvidence('d-1', makePhoto(600 * 1024));

    expect(result).toEqual({ ok: false, error: 'too_large_for_fallback' });
    expect(mockApi.attachDisputeEvidence).not.toHaveBeenCalled();
  });

  it('confirm после успешного PUT упал → upload_failed, без дублирования', async () => {
    mockApi.disputeEvidenceUploadUrl.mockResolvedValue({
      objectKey: 'disputes/d-1/abc.jpg',
      uploadUrl: 'http://minio.local/x?sig=put',
      expiresIn: 600,
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    // Confirm падает: не уходим в fallback (файл УЖЕ в хранилище,
    // повторная загрузка data:-URL создала бы дубль доказательства).
    mockApi.attachDisputeEvidence.mockRejectedValue(new Error('confirm failed'));

    const result = await uploadDisputeEvidence('d-1', makePhoto());

    expect(result).toEqual({ ok: false, error: 'upload_failed' });
    // Ровно одна попытка confirm — fallback не зовём.
    expect(mockApi.attachDisputeEvidence).toHaveBeenCalledTimes(1);
  });

  it('fallback confirm тоже упал → network, без тихих потерь', async () => {
    mockApi.disputeEvidenceUploadUrl.mockRejectedValue({ status: 503 });
    mockApi.attachDisputeEvidence.mockRejectedValue(new Error('fallback failed'));

    const result = await uploadDisputeEvidence('d-1', makePhoto());

    expect(result).toEqual({ ok: false, error: 'network' });
  });

  it('bytesToDataUrl: корректный base64 для произвольных байтов', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // «hello»
    expect(bytesToDataUrl(bytes, 'image/jpeg')).toBe('data:image/jpeg;base64,aGVsbG8=');
  });
});
