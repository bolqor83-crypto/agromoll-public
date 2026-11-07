# ADR-040: Публичный API на Railway

- Статус: **Принято** (деплой — после передачи RAILWAY_TOKEN, см. runbook)
- Дата: 2026-11-07
- Этап: v0.8.0 «Public Launch» (подэтап B)
- Связанные: ADR-001 (стек), ADR-014 (PostGIS), ADR-022 (URL API вшивается
  в бандл на сборке), ADR-032 (автодеплой Vercel), DEPLOY.md (runbook),
  ADR-036 (S3-доказательства)

## Контекст

До v0.8.0 web-версия на Vercel работала без сервера: API поднимался только
на машине разработчика (`docker compose up` + `pnpm --filter api dev`),
поэтому https://agromoll-web.vercel.app честно показывал «Сервер не
настроен» (ADR-022). Для публичного запуска нужен постоянно живущий API
с: Postgres + **PostGIS** (init-миграция делает `CREATE EXTENSION postgis`,
geo-триггер — ADR-014), Redis (хранение SMS-кодов и сессий refresh-токенов),
публичным HTTPS-доменом и миграциями при каждом деплое.

## Решение

### Почему Railway, а не альтернативы

| Критерий | Railway | Render | Vercel (serverless) |
|---|---|---|---|
| Managed Postgres + PostGIS | ✅ плагин PostgreSQL, `CREATE EXTENSION postgis` из миграции | ⚠️ расширение postgis доступно, но тариф Hobby ограничивает хранилище | ❌ нет |
| Постоянный процесс NestJS | ✅ один сервис, `node dist/main.js` | ✅ | ⚠️ функции с cold start, WebSocket/таймеры — боль |
| Redis как плагин | ✅ один клик | ✅ | ❌ внешний сервис |
| CLI для автоматизации | ✅ `railway up/run/domain` покрывает всё | ⚠️ API есть, CLI вторичен | — |
| Миграции `prisma migrate deploy` | ✅ в startCommand перед стартом | ✅ | ⚠️ только через отдельный job |

Vercel serverless отпал первым: API — stateful-процесс (шедулеры истечения
броней, outbox, длительные соединения Prisma), а не набор функций.
Render подошёл бы, но Railway выбран за managed-плагины Postgres+Redis
в одном проекте и CLI-first автоматизацию (весь деплой скриптуется —
важно для повтора средой агента). Render оставлен как fallback
(`RENDER_API_KEY`) — структура env и startCommand переносятся 1:1.

### Конфигурация как код

`railway.json` в корне репо:

- **build**: Nixpacks + pnpm (версия читается из `packageManager` в
  package.json), `turbo run build --filter=@agromoll/api` — тот же граф
  сборки, что в CI (сначала workspace-пакеты types/validation, потом API
  с `prisma generate && nest build`).
- **deploy**: `prisma migrate deploy` перед стартом — схема БД всегда
  соответствует миграциям репозитория; `healthcheckPath: /health`
  (liveness без БД, ADR-001), рестарт при падении.

### Секреты и переменные

Все переменные — только через Railway → Variables (UI или CLI), в репо
их нет. JWT-секреты генерируются `openssl rand -hex 32`, по одному на
access/refresh. `CORS_ORIGIN=https://agromoll-web.vercel.app` сужает CORS
(main.ts: без переменной — прежний `origin: true`, чтобы dev и e2e не
заметили разницы). `PORT` инжектит Railway (main.ts: `API_PORT ?? PORT ?? 3000`).

S3-переменные из v0.7.0 (ADR-036) на прод не обязательны: storage-модуль
имеет явный fallback — без S3 фото и доказательства живут в data:-URL.
Для демо-лотов используются внешние URL картинок (см. v0.8.0-C).

### Связка с Vercel

Публичный домен Railway (`…up.railway.app`) прописывается в проекте
`agromoll-web` как `EXPO_PUBLIC_API_URL` (Production), затем redeploy:
адрес вшивается в бандл на сборке (ADR-022) — существующий деплой сам
его не подхватит.

### Откат

1. **Плохой код**: Railway → Deployments → предыдущий деплой → Redeploy
   (или `railway rollback` в CLI). Миграции не откатываются автоматом —
   `prisma migrate deploy` идемпотентен и не применяет down; опасные
   изменения схемы проходят через новую компенсирующую миграцию.
2. **Плохие данные**: сид идемпотентен (upsert по phone/id, v0.8.0-C),
   повторный прогон чинит демо-набор.
3. **Совсем сломано**: сервис ставится на паузу, фронт покажет
   «Сервер не отвечает» — деградация без потери данных.

## Последствия

- API получает публичный HTTPS-домен с авто-сертификатами Railway.
- Ежемесячная стоимость Hobby-плана Railway укладывается в trial/базовый
  тариф; при росте — переход на Pro без смены конфигурации.
- Добавляется ручной шаг: `EXPO_TOKEN` в GitHub Secrets (для OTA, ADR-042)
  и RAILWAY_TOKEN в окружение агента — оба задаются один раз,
  задокументированы в v0.8.0-A-env-check.md.
