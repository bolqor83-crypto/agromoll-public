/**
 * Загрузка фото товара (v0.7.0-D, ADR-038) — клиентский поток.
 *
 * Тот же контракт, что у доказательств споров (evidence-upload.ts,
 * ADR-036): presigned URL → PUT прямо в S3-хранилище → confirm с
 * objectKey. Fallback (хранилище не настроено / 503 / сеть лежит) —
 * data:-URL ≤ 500 КБ через тот же confirm-эндпоинт: витрина без S3
 * (локальный dev) тоже показывает настоящие фото, а не иконки.
 *
 * Отличие от доказательств: файлы НЕ критичные. Ошибка загрузки фото
 * не должна ронять создание лота — вызывающий код решает, как показать
 * предупреждение (CreateListingModal: «лот создан, 1 фото не загрузилось»).
 */
import { api } from '../api';
import { logger } from '../logger';
import { bytesToDataUrl, FALLBACK_MAX_BYTES, type PreparedPhoto } from './photo';

/** Что пошло не так — человекочитаемо для UI. */
export type PhotoUploadError = 'too_large_for_fallback' | 'upload_failed' | 'network';

export interface PhotoUploadResult {
  ok: boolean;
  /** Код ошибки для тоста/алерта. */
  error?: PhotoUploadError;
}

/** PUT байтов по presigned URL (fetch: и web, и native). */
async function putToStorage(uploadUrl: string, photo: PreparedPhoto): Promise<boolean> {
  try {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': photo.mimeType },
      body: photo.bytes,
    });
    return response.ok;
  } catch (err) {
    logger.warn('listing-photo', 'S3 PUT упал', { err: String(err) });
    return false;
  }
}

/**
 * Загрузить одно фото к лоту (владелец уже проверен сервером:
 * upload-url/confirm вернут 403/404). Порядок вызовов — задача
 * вызывающего: фото грузятся по очереди, позиция = порядковый номер.
 */
export async function uploadListingPhoto(
  listingId: string,
  photo: PreparedPhoto,
): Promise<PhotoUploadResult> {
  // 1. Presigned URL. 503 — хранилище не настроено → fallback.
  try {
    const { objectKey, uploadUrl } = await api.listingPhotoUploadUrl(listingId, {
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
    });

    // 2. PUT напрямую в хранилище.
    if (await putToStorage(uploadUrl, photo)) {
      // 3. Confirm с objectKey (сервер сверит файл HEAD-запросом).
      try {
        await api.attachListingPhoto(listingId, {
          storage: 's3',
          objectKey,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
          sizeBytes: photo.sizeBytes,
        });
        return { ok: true };
      } catch (err) {
        logger.warn('listing-photo', 'confirm s3 упал', { err: String(err) });
        return { ok: false, error: 'upload_failed' };
      }
    }
    logger.warn('listing-photo', 'S3 PUT не удался — уходим в fallback');
  } catch (err) {
    // 503 (не настроено), 409 (лимит фото) или сеть — идём в fallback.
    logger.warn('listing-photo', 'upload-url недоступен', { err: String(err) });
  }

  // 4. Fallback: data:-URL ≤ 500 КБ. Сжатое фото (1200px/q80) обычно
  //    укладывается; если нет — честная ошибка, а не молчаливая потеря.
  if (photo.sizeBytes > FALLBACK_MAX_BYTES) {
    return { ok: false, error: 'too_large_for_fallback' };
  }
  try {
    await api.attachListingPhoto(listingId, {
      storage: 'data',
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      dataUrl: bytesToDataUrl(photo.bytes, photo.mimeType),
    });
    return { ok: true };
  } catch (err) {
    logger.warn('listing-photo', 'fallback confirm упал', { err: String(err) });
    return { ok: false, error: 'network' };
  }
}
