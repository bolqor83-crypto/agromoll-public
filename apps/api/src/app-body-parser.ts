/**
 * JSON-парсер с лимитом тела 4 МБ (v0.6.0-C, ADR-033).
 *
 * Доказательства споров приходят base64 ≤ 2 МБ (≈ 2.8 МБ строкой) —
 * дефолтный лимит express (100 КБ) режет их 413 ещё до zod-валидации.
 * Один хелпер для main.ts и e2e-тестов — лимит не разъезжается
 * (e2e не прогоняет main.ts, поэтому настройка переиспользуется явно).
 */
import { json, urlencoded } from 'express';
import type { INestApplication } from '@nestjs/common';

/** Лимит тела: 2 МБ файла в base64 + JSON-обвязка с запасом. */
export const JSON_BODY_LIMIT = '4mb';

/** Подключить парсеры с увеличенным лимитом (после bodyParser: false). */
export function useJsonBodyLimit(app: INestApplication): void {
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
}
