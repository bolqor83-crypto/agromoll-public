# DEPLOY.md — план деплоя публичного API

> Статус: v0.6.1 (ADR-022). Сейчас **web-версия на Vercel работает без
> сервера** и показывает экран «Сервер не настроен» — это честное
> состояние, пока API не опубликован. Документ описывает, как его
> опубликовать.

## Текущее состояние (вариант b — MVP)

| Компонент | Где живёт | Статус |
|---|---|---|
| Web (Expo export) | Vercel, проект `agromoll-web`, https://agromoll-web.vercel.app | ✅ деплоится |
| API (NestJS) | машина разработчика (`docker compose up` + `pnpm --filter @agromoll/api dev`) | 🔴 не публичный |
| Postgres + PostGIS | docker-compose локально | 🔴 не публичный |
| Redis | docker-compose локально | 🔴 не публичный |

Почему так (быстро и безопасно, решение v0.6.1-0): публикация API —
отдельная задача с секретами, доменами и миграциями; хотфикс прода
не должен был на ней блокироваться. Минус очевиден: вне машины
разработчика приложение показывает «Сервер не настроен».

## Что нужно, чтобы прод ожил (3 шага)

1. Поднять API публично (варианты ниже).
2. Задать адрес в Vercel: **Project `agromoll-web` → Settings →
   Environment Variables → `EXPO_PUBLIC_API_URL` = `https://<api-domain>`**
   (Environment: Production). Альтернатива — прописать значение прямо в
   `apps/mobile/vercel.json` в buildCommand, но Project Settings
   предпочтительнее: без правки репозитория.
3. Redeploy проекта `agromoll-web` (Deployments → ... → Redeploy) —
   адрес вшивается в бандл **на сборке** (ADR-022), существующий деплой
   адрес не подхватит.

## Тайлы карты: провайдер по ключу (v0.7.0-E, ADR-039)

По умолчанию карта — открытые тайлы OpenStreetMap (без ключей, fair
use). При росте трафика подключается платный провайдер — переменными
**Project Settings в том же Vercel** (вшиваются в бандл на сборке,
как `EXPO_PUBLIC_API_URL`):

| Переменная | Обязательна | Пример |
|---|---|---|
| `EXPO_PUBLIC_MAP_TILES_URL` | да | `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=ВАШ_КЛЮЧ` |
| `EXPO_PUBLIC_MAP_TILES_ATTRIBUTION` | желательна | `© OpenStreetMap contributors © MapTiler` |
| `EXPO_PUBLIC_MAP_TILES_MAX_ZOOM` | нет (19) | `21` |

После задания — Redeploy. Проверка: тайлы и подпись в правом нижнем
углу карты меняются на провайдера. Ключ протух/квота кончилась —
карта сама переключится на OSM после серии ошибок загрузки тайлов
(runtime-фолбэк, ADR-039). Пустые/кривые значения = OSM-дефолт.

> Локальная сборка с другим `EXPO_PUBLIC_API_URL`: кэш трансформаций
> Metro не учитывает env-переменные — пересобирайте с флагом
> `--clear` (он уже вшит в `pnpm --filter @agromoll/mobile build`).
> На Vercel окружение каждой сборки чистое — проблемы нет.

Проверка: в готовом бандле должен найтись адрес API и не должно быть
`api-not-configured.invalid`:

```bash
curl -s https://agromoll-web.vercel.app/ | grep -o 'src="[^"]*\.js"' # → путь к entry-чанку
curl -s https://agromoll-web.vercel.app/<entry-чанк> | grep -c 'api-not-configured.invalid' # → 0
```

## Вариант a-1: API в Docker на PaaS (рекомендуемый)

**Railway / Render / Fly.io** — `docker-compose.yml` репозитория уже
описывает весь стек (postgres+postgis, redis), NestJS запускается тем же
образом, что локально.

Почему рекомендуется: API использует **долгоживущие соединения Redis,
cron-задачи** (гашение TTL доставок каждые 5 мин, автоподтверждение
приёмки), **WebSocket не задействован, но Prisma + connection pool**
плохо переносят serverless-холодные старты. Обычный контейнер без этих
проблем.

Шаги:

1. Создать проект на PaaS, подключить GitHub-репозиторий.
2. Сервисы: `api` (образ из `apps/api`, PORT из `API_PORT`), `postgres`
   (образ `postis/postgis:16-3.4`), `redis` (образ `redis:7-alpine`) —
   повторяют `docker-compose.yml`. Для файлов (доказательства споров,
   фото товаров) вместо self-hosted S3 из compose лучше managed-бакет:
   Yandex Object Storage / Cloudflare R2 / AWS S3 — код одинаков
   (ADR-036), меняются только `S3_*` переменные.
3. Переменные окружения — все из `.env.example` (раздел «API»):
   `DATABASE_URL`/`REDIS_URL` на внутренние адресы PaaS,
   `S3_*` на managed-бакет (см. ADR-036 «Ручные шаги»: бакет + CORS),
   **`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` — длинные случайные строки**
   (dev-дефолты в проде запрещены, старт упадёт — так задумано).
4. Миграции: `pnpm --filter @agromoll/api exec prisma migrate deploy`
   (release-команда PaaS или разово из консоли).
5. Домен: закрепить за `api` постоянный HTTPS-домен PaaS (или свой
   поддомен `api.agromoll.ru` через DNS).
6. Выполнить «3 шага» выше.

## Вариант a-2: API на Vercel (serverless)

Технически возможно: `@vendia/serverless-express`-адаптер вокруг NestJS,
`api/index.ts` как entry, `vercel.json` с `rewrites` на `/api/*`.
**Не рекомендуется сейчас**, потому что:

- cron (`@nestjs/schedule`) в serverless не работает без Vercel Cron —
  потребуется вынос TTL-гашения и автоподтвержения в отдельные endpoints;
- Prisma в lambda = холодный старт ~1–2 с на каждый чих, connection
  pool приходится ограничивать (PgBouncer);
- PostGIS остаётся внешним (Neon/Supabase) — миграции придётся
  прогонять наружу.

Вернуться к этому варианту, если захочется «всё в одном Vercel» и
трафик останется небольшим.

## Вариант a-3: VPS

Полный контроль (Hetzner/Selectel/Тимвеб), docker-compose под systemd
или Dokku. Дешевле всех на длинной дистанции, но: обновления ОС, бэкапы
Postgres, TLS-сертификаты — ручная работа. Имеет смысл, когда появится
постоянный админ.

## Чек-лист безопасности перед публикацией

- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — случайные ≥32 символов
      (старт API без них падает: `main.ts` валидирует, v0.3.1).
- [ ] `DATABASE_URL` не содержит dev-пароля из репозитория.
- [ ] CORS API: разрешить только домен web-версии (сейчас `enableCors`
      в `main.ts` — проверить политику перед продом).
- [ ] Rate limit на `/auth/request-code` уже есть — убедиться, что
      секреты SMS-провайдера не dev-заглушки (пока код 0000 в dev).
- [ ] Бэкапы Postgres (pg_dump по cron) — долги и часы 289-ФЗ терять нельзя.

## Связанное

- ADR-022 — почему env, почему нет prod-фолбэка.
- `apps/mobile/vercel.json` — как EXPO_PUBLIC_API_URL попадает в сборку.
- `docker-compose.yml` — локальный стек (источник образов для a-1).
