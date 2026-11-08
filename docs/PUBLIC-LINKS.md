# PUBLIC-LINKS.md — публичные ссылки АгроМолл (v0.8.1)

> Единая точка правды «что доступно по ссылке и чего не хватает».
> Обновляется по мере передачи токенов и прохождения runbook'ов
> (RENDER_API_KEY → API ✅, NEON_API_KEY → БД ✅, EXPO_TOKEN → сборка и OTA).

## Сводка

| Компонент | URL | Статус | Что нужно |
|---|---|---|---|
| Web-приложение | https://agromoll-web.vercel.app | 🟢 **работает на живых данных** (v0.8.1) | — |
| API | https://agromoll-api.onrender.com | 🟢 **задеплоен** (Render free, Frankfurt; см. «Особенности free tier») | — |
| БД | Neon `agromoll-api` (Frankfurt, PG16 + PostGIS 3.3) | 🟢 миграции 17/17, сид: 45 лотов, 27 пользователей | — |
| Android .apk | ссылка установки EAS (internal distribution) | 🔴 не собран | `EXPO_TOKEN` → [runbook D](release/v0.8.0-D-eas-runbook.md) |
| OTA-канал | EAS Update, ветка `production` | 🔴 не инициализирован | `EXPO_TOKEN` → `eas init` (runbook D, шаг 1) |
| Демо-вход | SMS-код «000000» | 🟢 **проверен на проде** (09.11.2026, скриншоты `docs/screenshots/v0.8.1-prod/`) | — |

## Web — работает на живом API

- URL: **https://agromoll-web.vercel.app** — вход по любому демо-телефону
  из [DEMO.md](DEMO.md), код «000000» (шесть нулей).
- `EXPO_PUBLIC_API_URL=https://agromoll-api.onrender.com` задана в
  Vercel production и вшита в бандл (09.11.2026); деплой — через
  `pnpm deploy:vercel` (ADR-032), автодеплой из `main` — workflow
  `Deploy (Vercel)`.
- История: в v0.8.0 сайт показывал «Сервер не настроен» — API на
  Railway был заблокирован платформенным инцидентом QBCLHG1V
  (isStable=false с 05.11.2026, без ETA). v0.8.1 ушла на Render+Neon.

## API — Render free tier

- URL: **https://agromoll-api.onrender.com** (`/health` → 200,
  service `srv-dbobfevf3r2c73amlng0`, Frankfurt — рядом с Neon).
- Деплой из **публичного зеркала**
  [bolqor83-crypto/agromoll-public](https://github.com/bolqor83-crypto/agromoll-public)
  (ветка `feature/v0.8.1-render-api`) — **постоянное решение** (v0.8.1-D
  закрыт 09.11.2026, ADR-040): Render без установленного GitHub App не
  клонит приватные репозитории («unfetchable»), зеркало синхронизируется
  пушем из основного репо; деплой — ручной триггер (webhook на зеркало
  невозможен).
- **Особенности free tier**: спин-даун после ~15 мин простоя, холодный
  старт 30–50 сек (первый запрос «зависает», потом всё быстро);
  переход на Starter $7/мес снимает проблему (ADR-040).
- Демо без Redis (ADR-040): `SESSION_ALLOW_IN_MEMORY=true` — после
  рестарта/спин-дауна нужно перелогиниться демо-кодом (access-токены
  15 мин живут как жили).
- Секреты: `DATABASE_URL` (Neon pooled) — через Render API, не в
  репо; JWT-секреты сгенерированы Render'ом.

## БД — Neon (serverless Postgres)

- Проект `agromoll-api` (id `silent-hill-19081344`), Frankfurt
  `aws-eu-central-1`, PostgreSQL 16 + **PostGIS 3.3**.
- Миграции 17/17 (`prisma migrate deploy`), сид v0.8.0-C: 45 лотов
  (фото — внешние picsum.photos), 27 пользователей (16 продавцов,
  6 покупателей, 3 водителя, 2 арбитра), брони, долги, доставки,
  споры, блокировка 289-ФЗ с апелляцией.
- Free tier Neon не удаляется через 30 дней (в отличие от Render
  Postgres) — почему Neon, см. ADR-040.

## .apk и OTA — после передачи EXPO_TOKEN

- Сборка: [v0.8.0-D-eas-runbook.md](release/v0.8.0-D-eas-runbook.md) —
  `eas init` (фиксирует `projectId` в `app.json`), замена
  `PLACEHOLDER_API_URL` в `eas.json` на `https://agromoll-api.onrender.com`,
  затем `eas build --platform android --profile preview` (10–20 минут).
- iOS требует Apple Developer ($99/год) — осознанно отложено (ADR-041).
- OTA: `EXPO_TOKEN` в GitHub Secrets (Settings → Secrets and variables →
  Actions, имя `EXPO_TOKEN`) — **ручной шаг владельца репозитория**;
  после этого workflow `OTA update (EAS)` публикует JS-бандл при каждом
  пуше в `main` (ADR-042). До добавления секрета workflow падает с
  понятным сообщением — это контроль, что обновления не пропадают
  «молча». Откат: `eas update:rollback --branch production`.

## Чек-лист «день публичного запуска» — ✅ выполнен 09.11.2026

1. ~~Деплой API~~ — Render+Neon вместо Railway (инцидент QBCLHG1V),
   подробности: [v0.8.1 release notes](release/v0.8.1-release.md).
2. `EXPO_PUBLIC_API_URL` в Vercel → прод-редеплой web → сайт ожил
   (лента, вход, витрины — скриншоты `docs/screenshots/v0.8.1-prod/`).
3. ~~Смоук-прогон по DEMO.md~~ — web → вход «000000» → лента
   (45 лотов) → витрина продавца → смена роли; `curl /health` → 200.
4. Осталось: `EXPO_TOKEN` → .apk + OTA (runbook D).

## Скриншоты

- **Прод v0.8.1** (живой API): `docs/screenshots/v0.8.1-prod/` — лента
  покупателя (light/dark), витрина продавца.
- Локальный E2E-прогон всех ролей (покупатель/продавец/водитель/арбитр,
  включая споры, блокировку 289-ФЗ и апелляцию):
  `docs/screenshots/v0.8.0-local/` (36 скриншотов + видео цикла
  покупателя).
