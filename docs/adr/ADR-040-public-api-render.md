# ADR-040: Публичный API — Render + Neon (вместо Railway)

- Статус: **Принято** (v0.8.0 — Railway; **заменено в v0.8.1** на Render + Neon)
- Дата: 2026-11-07 (Railway) / 2026-11-09 (перенос на Render)
- Этап: v0.8.0 «Public Launch» подэтап B → v0.8.1 «Public API on Render»
- Связанные: ADR-001 (стек), ADR-008 (сессии/Redis), ADR-014 (PostGIS),
  ADR-022 (URL API вшивается в бандл на сборке), ADR-032 (автодеплой Vercel),
  ADR-036 (S3-доказательства), docs/release/v0.8.0-B-railway-runbook.md (история)

## Контекст

До v0.8.0 web-версия на Vercel работала без сервера: API поднимался только
локально, и https://agromoll-web.vercel.app показывал «Сервер не настроен»
(ADR-022). v0.8.0 планировала постоянный API на Railway (runbook B), но
платформа ушла в инцидент **QBCLHG1V** «External network blocks affecting
access to Railway» (статус IDENTIFIED с 2026-11-05, `platformStatus.isStable
= false`, деплои на паузе). Три суточных проверки (20:13, 22:13, 23:13
2026-11-08) не дали зелёного света — прод не мог ждать неопределённое время,
фронт продолжал показывать «Сервер не настроен» с бандлом 0.8.0.

Нужно: постоянно живущий API с Postgres + **PostGIS** (geo-триггер, ADR-014),
публичным HTTPS-доменом, демо-входом («000000», ADR-040 v0.8.0-C) — на
платформах, доступных прямо сейчас.

## Решение (v0.8.1)

**Web-сервис `agromoll-api` на Render (free, Frankfurt) + serverless Postgres
16 на Neon (Frankfurt, PostGIS 3.3). Без Redis** — демо-режим сессий в памяти
(явный opt-in, см. ниже).

### Почему Render вместо Railway

| Критерий | Railway (план v0.8.0) | Render (v0.8.1) |
|---|---|---|
| Доступность платформы | ❌ инцидент QBCLHG1V, деплои на паузе 4+ дня | ✅ API отвечает, деплой сразу |
| Автоматизация | ✅ CLI-first | ✅ REST API (`api.render.com/v1`) + `render.yaml` (IaC) |
| Постоянный процесс NestJS | ✅ | ✅ (runtime node, свой startCommand) |
| Free tier | trial/Hobby $5 | ✅ web-сервис free (512 МБ, спин-даун) |
| Управляемый Postgres | ✅ плагин | ⚠️ free Postgres **удаляется через 30 дней** → не годится, БД вынесена на Neon |

Vercel serverless отпадал как и в v0.8.0: API — stateful-процесс (шедулеры
истечения броней, outbox, пул соединений Prisma), а не набор функций.

### Почему Neon для БД

- **Free tier не удаляется** (в отличие от Render free Postgres — 30 дней):
  демо-прод живёт неограниченно долго.
- **PostGIS доступен на free**: проверено 2026-11-09 —
  `CREATE EXTENSION IF NOT EXISTS postgis` → `PostGIS_Version()` = 3.3
  (USE_GEOS=1, USE_PROJ=1), PostgreSQL 16.15.
- Serverless-модель (compute приостанавливается при простое) не расходует
  бесплатную квоту compute-часов на idle — важно для демо с редким трафиком.
- Регион `aws-eu-central-1` (Frankfurt) — рядом с Render-сервисом
  (`frankfurt`): RTT единицы миллисекунд.

Проект: `agromoll-api` (id `silent-hill-19081344`), БД `neondb`,
роль `neondb_owner`. Создан через `POST /api/v2/projects` (org
`org-cool-flower-77247583`; personal API-ключ требует `org_id` внутри
`project{}`; регион в новой номенклатуре — `aws-eu-central-1`, старый
`aws-fra-1` орге недоступен).

### Демо-компромисс без Redis (SESSION_ALLOW_IN_MEMORY)

Sms-коды и сессии refresh-токенов живут в Redis (ADR-008); в production без
`REDIS_URL` API принципиально не стартовал (fail-closed — неотзываемые
refresh-токены выдавать нельзя). Бесплатного постоянного Redis в стеке нет
(Upstash — отдельный аккаунт/ключ; Render Key Value free удаляется через
30 дней и после этого уронил бы API при старте). Поэтому в v0.8.1-B добавлен
**явный opt-in `SESSION_ALLOW_IN_MEMORY=true`**:

- SMS-коды — in-memory (заглушка и раньше не требовала Redis);
- refresh-сессии — в памяти процесса: **рестарт/спин-даун Render сбрасывает
  их**, пользователь перелогинивается демо-кодом «000000» — для демо-продукта
  приемлемо; access-токены (15 мин) не затронуты;
- при заданном `REDIS_URL` флаг игнорируется — боевой запуск просто
  подключает Redis и убирает флаг, код не меняется.

Флаг покрыт unit-тестами (`session-store.spec.ts`: fail-closed без флага,
in-memory с флагом, приоритет REDIS_URL).

### Конфигурация как код

`render.yaml` в корне репо (спецификация сервиса для Render Blueprint; живой
сервис создан через `POST https://api.render.com/v1/services` с теми же
параметрами):

- **build**: `corepack` (pnpm 9.15.9 из `packageManager`) →
  `pnpm install --frozen-lockfile` → `pnpm turbo run build --filter=@agromoll/api`
  — тот же граф сборки, что в CI (сначала workspace-пакеты types/validation,
  потом API с `prisma generate && nest build`).
- **start**: `node apps/api/dist/src/main.js` (вложенность `dist/src` —
  из `nest build`; читается из `apps/api/package.json` `start`).
- **env**: `NODE_ENV=production`, `NODE_VERSION=22`, JWT-секреты —
  `generateValue` (генерирует Render), TTL-константы — из ТЗ v0.8.1,
  `CORS_ORIGIN=https://agromoll-web.vercel.app`, `AUTH_DEMO_LOGIN=true`
  (демо-код «000000»), `SESSION_ALLOW_IN_MEMORY=true`, `DATABASE_URL` —
  **pooled**-строка Neon (`…-pooler…neon.tech/…?sslmode=require&pgbouncer=true&connection_limit=5`).

Пул соединений Prisma идёт через Neon PgBouncer (pooler-эндпоинт):
мультиплексирование + compute Neon может засыпать без ущерба для квоты.
**Миграции — по direct-строке** (без pooler: advisory locks и DDL Prisma
в transaction-режиме PgBouncer ненадёжны): `DATABASE_URL_DIRECT` в
окружении агента, `pnpm --filter @agromoll/api exec prisma migrate deploy`,
затем `db:seed` (сид идемпотентен — upsert по phone/id, v0.8.0-C).
Схема и сид применяются из окружения агента; автозапуск миграций при деплое
не делается (осознанно: free-контейнер не должен падать на миграциях,
 future-изменения схемы — из CI/агента, задокументировано здесь).

S3-переменные (ADR-036) не обязательны: без них storage-модуль использует
data:-URL fallback, демо-лоты — внешние URL картинок (v0.8.0-C).

### Связка с Vercel

Публичный домен Render (`https://agromoll-api.onrender.com`) прописывается
в проекте Vercel как `EXPO_PUBLIC_API_URL` (Production), затем пересборка:
адрес вшивается в бандл на сборке (ADR-022) — существующий деплой сам его
не подхватит. См. v0.8.1-C.

### Откат

1. **Плохой код**: Render → Deployments → предыдущий деплой → Rollback
   (или `POST /v1/services/{id}/deploys/{deploy_id}/rollback`). Миграции не
   откатываются автоматом (идемпотентный `migrate deploy`, компенсирующие
   миграции при опасных изменениях).
2. **Плохие данные**: повторный `db:seed` чинит демо-набор (идемпотентен).
3. **Совсем сломано**: сервис ставится на паузу, фронт покажет «Сервер не
   отвечает» — деградация без потери данных. Возврат на Railway возможен
   после снятия инцидента QBCLHG1V (runbook v0.8.0-B актуален).

## Ограничения free tier и план перехода на платный

- **Спин-даун**: Render free web-сервис засыпает через 15 минут простоя;
  первый запрос после сна — «холодный старт» 30–50 сек (задокументировано
  в PUBLIC-LINKS.md). Для демо приемлемо.
- 512 МБ RAM / shared CPU — хватает для API + demo-нагрузки; тяжёлые
  выгрузки могут упереться.
- **Render Starter $7/мес** снимает спин-даун (сервис всегда живой) —
  первый плановый апгрейд при реальных пользователях; конфигурация не
  меняется (только `plan: starter`).
- Neon free: ~0.5 ГБ хранилища, compute-часы восполняются ежемесячно;
  при исчерпании — Scale plan.

## Последствия

- API получает постоянный публичный HTTPS-домен на Render с авто-TLS.
- Стоимость: $0/мес (оба free tier); апгрейд-путь задокументирован.
- Секреты только в окружении Render (generateValue/ручные), в репо их нет.
- Рестарты/спин-дауны сбрасывают refresh-сессии (демо-компромисс выше);
  боевой запуск: Redis (Upstash free / Render Key Value) + убрать флаг
  `SESSION_ALLOW_IN_MEMORY`.
- История решения v0.8.0 (Railway, сравнение платформ, runbook) — в
  docs/release/v0.8.0-B-railway-runbook.md; Railway остаётся резервным
  вариантом после снятия инцидента.
