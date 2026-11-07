/**
 * Загрузка доказательства в спор (v0.7.0-B, ADR-036) — клиентский поток.
 *
 * Счастливый путь: presigned URL → PUT прямо в S3-хранилище → confirm
 * с objectKey. Трафик не проходит через API.
 *
 * Fallback (хранилище не настроено / 503 / сеть до S3 лежит): то же
 * фото ужимается до ≤ 500 КБ и уходит data:-URL через confirm-эндпоинт.
 * Критические доказательства не теряются из-за инфраструктуры.
 */
import { api } from '../api';
import { logger } from '../logger';
import { bytesToDataUrl, FALLBACK_MAX_BYTES, type PreparedPhoto } from './photo';

/** Что пошло не так — человекочитаемо для UI. */
export type EvidenceUploadError =
  | 'too_large_for_fallback'
  | 'upload_failed'
  | 'network';

export interface EvidenceUploadResult {
  ok: boolean;
  /** Сообщение для тоста при ошибке. */
  error?: EvidenceUploadError;
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
    logger.warn('evidence', 'S3 PUT упал', { err: String(err) });
    return false;
  }
}

/**
 * Полный поток загрузки фото-доказательства в активный спор.
 * Участник уже проверен сервером (upload-url/confirm вернут 403/404).
 */
export async function uploadDisputeEvidence(
  disputeId: string,
  photo: PreparedPhoto,
): Promise<EvidenceUploadResult> {
  // 1. Presigned URL. 503 — хранилище не настроено → fallback.
  try {
    const { objectKey, uploadUrl } = await api.disputeEvidenceUploadUrl(disputeId, {
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
    });

    // 2. PUT напрямую в хранилище.
    if (await putToStorage(uploadUrl, photo)) {
      // 3. Confirm с objectKey (сервер сверит файл HEAD-запросом).
      try {
        await api.attachDisputeEvidence(disputeId, {
          storage: 's3',
          objectKey,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
          sizeBytes: photo.sizeBytes,
        });
        return { ok: true };
      } catch (err) {
        logger.warn('evidence', 'confirm s3 упал', { err: String(err) });
        return { ok: false, error: 'upload_failed' };
      }
    }
    logger.warn('evidence', 'S3 PUT не удался — уходим в fallback');
  } catch (err) {
    // 503 (не настроено) или сеть — идём в fallback без шума.
    logger.warn('evidence', 'upload-url недоступен', { err: String(err) });
  }

  // 4. Fallback: data:-URL ≤ 500 КБ. Сжатое фото (1200px/q80) обычно
  //    укладывается; если нет — честная ошибка, а не молчаливая потеря.
  if (photo.sizeBytes > FALLBACK_MAX_BYTES) {
    return { ok: false, error: 'too_large_for_fallback' };
  }
  try {
    await api.attachDisputeEvidence(disputeId, {
      storage: 'data',
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      dataUrl: bytesToDataUrl(photo.bytes, photo.mimeType),
    });
    return { ok: true };
  } catch (err) {
    logger.warn('evidence', 'fallback confirm упал', { err: String(err) });
    return { ok: false, error: 'network' };
  }
}
