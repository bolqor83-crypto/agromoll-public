/**
 * Константы S3-хранилища (v0.7.0-B, ADR-036).
 *
 * Хранилище — любое S3-совместимое: AWS S3, Cloudflare R2, Yandex
 * Object Storage, MinIO (dev/CI). Код один и тот же — меняется только
 * конфиг: S3-протокол де-факто стандарт, привязка к провайдеру не нужна.
 */

/** Эндпоинт S3-API (например http://localhost:9000 для MinIO). Пусто — AWS по умолчанию. */
export const S3_ENDPOINT = 'S3_ENDPOINT';

/** Имя бакета для файлов (создаётся автоматически, если прав хватает). */
export const S3_BUCKET = 'S3_BUCKET';

/** Access key (в dev/CI — из docker-compose, в проде — от провайдера). */
export const S3_ACCESS_KEY = 'S3_ACCESS_KEY';

/** Secret key. Только в .env/секретах PaaS, никогда не коммитится. */
export const S3_SECRET_KEY = 'S3_SECRET_KEY';

/** Регион (для AWS обязателен; MinIO игнорирует, но требует непустого). */
export const S3_REGION = 'S3_REGION';

/**
 * Path-style доступ (http://endpoint/bucket/key). true — для MinIO,
 * R2, Yandex Object Storage; false — виртуальные хосты AWS
 * (bucket.s3.region.amazonaws.com). По умолчанию = задан ли S3_ENDPOINT.
 */
export const S3_FORCE_PATH_STYLE = 'S3_FORCE_PATH_STYLE';

/** Регион по умолчанию (MinIO принимает любой, но sigV4 требует непустой). */
export const DEFAULT_S3_REGION = 'us-east-1';

/** TTL presigned PUT-URL: за это время клиент должен успеть загрузить файл. */
export const S3_PUT_URL_TTL_SECONDS = 600;

/** TTL presigned GET-URL: доказательства приватны, ссылки короткоживущие. */
export const S3_GET_URL_TTL_SECONDS = 3600;

/** Максимум файла в хранилище: фото/сканы накладных с запасом. */
export const S3_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Максимум fallback-файла (data:-URL в БД): 500 КБ — только критические
 * случаи при недоступном хранилище, БД не должна пухнуть (ADR-036).
 */
export const DATA_URL_MAX_BYTES = 500 * 1024;

/**
 * Разрешённые типы доказательств: фото (jpeg/png/webp) и сканы
 * накладных (pdf). Прочее отклоняется на входе — и в presigned-запросе,
 * и в fallback.
 */
export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];

/** MIME → расширение файла в object key. */
export const MIME_EXTENSION: Record<EvidenceMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Префикс object key для доказательств: disputes/<disputeId>/<uuid>.<ext>. */
export const EVIDENCE_KEY_PREFIX = 'disputes';

/** Протокольная схема fileUrl для объектов хранилища. */
export const S3_URL_SCHEME = 's3://';

/** Протокольная схема fileUrl для fallback (data:-URL). */
export const DATA_URL_PREFIX = 'data:';

/** Извлечь objectKey из fileUrl (s3://key); null — не S3-форма. */
export function s3KeyFromFileUrl(fileUrl: string): string | null {
  if (!fileUrl.startsWith(S3_URL_SCHEME)) {
    return null;
  }
  const key = fileUrl.slice(S3_URL_SCHEME.length);
  return key.length > 0 ? key : null;
}

/** objectKey принадлежит спору? (disputes/<disputeId>/…) — защита от confirm чужого ключа. */
export function keyBelongsToDispute(objectKey: string, disputeId: string): boolean {
  return objectKey.startsWith(`${EVIDENCE_KEY_PREFIX}/${disputeId}/`);
}
