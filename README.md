# АгроМолл

[![Version](https://img.shields.io/badge/version-0.3.0-2D6A4F)](package.json)
[![CI](https://github.com/bolqor83-crypto/agromoll/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bolqor83-crypto/agromoll/actions/workflows/ci.yml)

Мобильное приложение для оптово-розничного рынка «Агро Молл» (Ростов-на-Дону).
**Текущий этап — v0.3.0 «Аутентификация и офлайн-ядро»**: вход по телефону
+ JWT, локальная очередь мутаций (outbox) с идемпотентностью на сервере,
zod-валидация ответов API на клиенте.
Бронирование (v0.2.0) полностью сохранено. Долги, учёт часов, доставка
и оплата — на следующих этапах.

## Что нового в v0.3.0

- **Аутентификация: телефон + SMS-код → JWT** —
  [ADR-007](docs/adr/ADR-007-auth.md):
  - `POST /auth/request-code` — код в Redis (TTL 5 минут); в dev
    код-заглушка **«0000»** и печатается в лог; rate limit
    **1 запрос/мин на телефон** (трекер по телефону, не по IP — на рынке
    все за одним Wi-Fi);
  - `POST /auth/verify` — одноразовый код → `accessToken` (15 минут) +
    `refreshToken` (30 дней) + профиль; `POST /auth/refresh` — новый access;
  - `JwtAuthGuard` (Authorization: Bearer) полностью заменил заглушку
    `X-User-Id`; роль всегда перечитывается из БД — подделать нельзя,
    смена роли действует сразу;
  - `GET /users/me`, `PATCH /users/me/role` — роль хранится на сервере;
  - мобильный клиент: экран входа (маска +7 (___) ___-__-__, 6 ячеек кода
    с авто-переходом, таймер повторной отправки 60 с, dev-подсказка),
    токены в `expo-secure-store`, авто-refresh при 401 (single-flight
    axios-интерцептор);
  - логи: маскированный телефон (`+7***1234`), без кодов и токенов.
- **Офлайн-ядро: outbox + идемпотентность + конфликты** —
  [ADR-006](docs/adr/ADR-006-offline-core.md):
  - локальная очередь мутаций в `expo-sqlite`: операции переживают обрыв
    сети и уходят с заголовком `X-Idempotency-Key` (uuid v4);
  - сервер: таблица `OutboxOperation` (уникальный `clientUuid`) +
    декоратор `@Idempotent()` — **дубль не создаёт вторую бронь**
    (реплей сохранённого результата); параллельный дубль → 409
    `IDEMPOTENCY_IN_PROGRESS`;
  - 6 состояний операции: pending / processing / retrying / conflicted /
    permanently_failed / completed; backoff 1с→2с→4с→8с→16с (максимум
    5 попыток); 5xx и сеть → retrying, прочие 4xx → permanently_failed;
  - все мутации броней идут ТОЛЬКО через outbox: создание, отмена,
    подтверждение, корректировка, принятие корректировки;
  - оптимистичный UI: бронь, созданная офлайн, сразу видна в «Моих бронях»
    с пометкой «Ждёт сети»;
  - конфликты не решаются молча: бизнес-409 → диалог
    **[Принять серверное] [Отменить локальную]**;
  - синхронизация: старт, сеть (NetInfo), передний план (AppState),
    pull-to-refresh, вручную;
  - индикатор в шапке: зелёная «Онлайн» / янтарная «Офлайн — сохраним» /
    пульсирующая «Синхронизация…»; тап → экран **«Очередь»** со всеми
    операциями и их состояниями;
  - выход из аккаунта очищает очередь — операции не утекают в чужую сессию.
- **Zod-валидация ответов API на клиенте**: схемы
  `ListingResponseSchema`, `BookingResponseSchema`, `UserResponseSchema`,
  `AuthResponseSchema`, `ErrorResponseSchema` (+ списковые) в
  `@agromoll/validation`; каждый ответ проверяется перед рендером —
  защита от «старый клиент + новый сервер», багов сериализации, частично
  MITM; лишние поля не отвергаются (passthrough); при провале —
  structured-лог с сырым ответом + мягкий EmptyState «Не удалось
  загрузить» вместо демо-данных.
- **Инфраструктура**: CI поднял Redis service-контейнер; e2e регистрируют
  пользователей через настоящий auth-флоу.
- **Тесты**: 130+ unit (api + mobile + пакеты) и 20+ e2e против реальных
  Postgres+PostGIS+Redis: полный auth-флоу (request-code → verify →
  /bookings → 401 → refresh), rate limit, дубль clientUuid, офлайн-сценарий
  «обрыв сети → восстановление».

### Скриншоты v0.3.0 (светлая + тёмная тема)

| Вход, шаг 1 — телефон                                        | Вход, шаг 2 — код из SMS                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| ![Вход 1, светлая](docs/design/screenshots/light-auth-step1.png) | ![Вход 2, светлая](docs/design/screenshots/light-auth-step2.png) |
| ![Вход 1, тёмная](docs/design/screenshots/dark-auth-step1.png)   | ![Вход 2, тёмная](docs/design/screenshots/dark-auth-step2.png)   |

| Индикатор офлайна: 3 состояния                                | Экран «Очередь»                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| ![Офлайн-индикатор](docs/design/screenshots/offline-indicator.png) | ![Очередь, светлая](docs/design/screenshots/light-queue.png) |
|                                                               | ![Очередь, тёмная](docs/design/screenshots/dark-queue.png)   |

Скриншоты v0.2.0 (лента, брони, витрина, входящие) — в
[истории README](https://github.com/bolqor83-crypto/agromoll/blob/v0.2.0/README.md).

## Стек

| Слой     | Технологии                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Mobile   | React Native (Expo SDK 52), Expo Router 4, TypeScript, Zustand, Reanimated 3, axios, expo-sqlite, expo-secure-store, NetInfo     |
| API      | NestJS 11, TypeScript, Prisma 6, @nestjs/jwt, @nestjs/throttler, ioredis, pino, @nestjs/schedule (cron TTL)                        |
| БД       | PostgreSQL 16 + PostGIS 3.4, Redis 7 (SMS-коды: TTL 5 минут)                                                                       |
| Монорепо | pnpm workspaces + Turborepo, ESLint 9, Prettier, GitHub Actions                                                                    |
| Пакеты   | `packages/types` (общие типы), `packages/validation` (zod: запросы + ответы), `packages/ui` (дизайн-система)                        |

## Структура

```
agromoll/
  apps/
    mobile/          — Expo-приложение: вход по телефону → выбор роли →
                       табы разделов (Покупатель: Лента/Мои брони;
                       Продавец: Витрина/Входящие; Доставщик: Радар/
                       Мои доставки), экран «Очередь», офлайн-ядро
                       (src/lib/outbox: service, sqlite-storage, transport)
    api/             — NestJS: /auth, /users, /listings, /bookings,
                       идемпотентность (@Idempotent), cron TTL, Prisma
  packages/
    ui/              — дизайн-система: токены, темы, Button, Card, Input,
                       Badge, Screen, Text, Icon, Skeleton, EmptyState,
                       TabBar, PullToRefreshScrollView
    types/           — общие типы (роли, листинги, брони, auth, телефон)
    validation/      — zod-схемы (запросы + схемы ответов API)
  docs/
    adr/             — ADR-001..007
    design/          — палитра и скриншоты (светлая/тёмная)
  docker-compose.yml — PostgreSQL + PostGIS, Redis
  turbo.json
  pnpm-workspace.yaml
```

## Быстрый старт

### Требования

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable` или `npm i -g pnpm`)
- Docker (для БД; на CI проверяется автоматически)

### Запуск с нуля

```bash
# 1. Клонировать и установить зависимости
git clone https://github.com/bolqor83-crypto/agromoll.git
cd agromoll
pnpm install

# 2. Поднять PostgreSQL + PostGIS и Redis
docker compose up -d --wait

# 3. Скопировать переменные окружения
cp .env.example .env                  # токены и URL (в .gitignore)
cp apps/api/.env.example apps/api/.env

# 4. Сгенерировать Prisma-клиент и применить миграции
pnpm db:generate
pnpm db:migrate

# 5. Засеять демо-аккаунты (с телефонами!) и витрину
pnpm --filter @agromoll/api db:seed

# 6. Собрать пакеты (types, validation, ui)
pnpm build

# 7. Запустить всё
pnpm dev
```

После запуска:

- API: `http://localhost:3000/health` — healthcheck
- Mobile (Expo): `http://localhost:8081` — Metro-сервер (w — web, a — Android, i — iOS)

**Вход в приложении**: любой телефон в формате +7 999 XXX-XX-XX,
код — **«0000»** (dev-заглушка; в production будет SMS).
Демо-аккаунты сида: `+7 961 123-00-01` (покупатель),
`+7 961 123-00-02` (продавец), `+7 961 123-00-03` (доставщик).

### Как потрогать auth-флоу вручную (curl)

```bash
# 1. Запросить код (в dev всегда «0000», смотрится в лог API)
curl -s -X POST http://localhost:3000/auth/request-code \
  -H "Content-Type: application/json" \
  -d '{"phone": "+7 961 123-00-01"}'
# → {"expiresInSec":300}

# 2. Проверить код → токены + профиль
curl -s -X POST http://localhost:3000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+7 961 123-00-01", "code": "0000"}'
# → {"accessToken":"…","refreshToken":"…","user":{…}}

TOKEN="полученный accessToken"
REFRESH="полученный refreshToken"

# 3. Профиль и смена роли
curl -s http://localhost:3000/users/me -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH http://localhost:3000/users/me/role \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"role": "seller"}'

# 4. Обновить access-токен
curl -s -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" -d "{\"refreshToken\": \"$REFRESH\"}"

# 5. Rate limit: второй код на тот же телефон в минуту → 429
curl -s -X POST http://localhost:3000/auth/request-code \
  -H "Content-Type: application/json" \
  -d '{"phone": "+7 961 123-00-01"}' -w "\n%{http_code}\n"
```

### Как потрогать флоу брони вручную (curl)

```bash
# Два входа: покупатель и продавец (токены из /auth/verify выше)
BUYER_TOKEN="…"
SELLER_TOKEN="…"

# 1. Покупатель смотрит ленту
curl -s http://localhost:3000/listings | head -c 400

# 2. Покупатель бронирует (listingId из ленты) — идемпотентно:
#    X-Idempotency-Key можно не передавать (обычный путь)
curl -s -X POST http://localhost:3000/bookings \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BUYER_TOKEN" \
  -d '{"listingId": "<LISTING_ID>", "requestedQuantity": 20}'

# 3. Продавец предлагает корректировку: 15 кг после 9:00
curl -s -X POST http://localhost:3000/bookings/<BOOKING_ID>/counter-offer \
  -H "Content-Type: application/json" -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{"offeredQuantity": 15, "pickupTime": "после 9:00"}'

# 4. Покупатель принимает
curl -s -X POST http://localhost:3000/bookings/<BOOKING_ID>/accept-counter \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BUYER_TOKEN" -d '{}'

# 5. Дубль не создаёт вторую бронь: тот же Idempotency-Key — тот же ответ
KEY=$(uuidgen)
curl -s -X POST http://localhost:3000/bookings \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "X-Idempotency-Key: $KEY" \
  -d '{"listingId": "<LISTING_ID>", "requestedQuantity": 5}'
curl -s -X POST http://localhost:3000/bookings \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "X-Idempotency-Key: $KEY" \
  -d '{"listingId": "<LISTING_ID>", "requestedQuantity": 5}'
# → оба ответа содержат id ОДНОЙ и той же брони
```

Отдельные части:

```bash
pnpm --filter @agromoll/api dev        # только API
pnpm --filter @agromoll/mobile dev     # только mobile
pnpm --filter @agromoll/mobile dev:web # web-версия в браузере
```

### Проверки

```bash
pnpm lint        # ESLint по всем пакетам
pnpm typecheck   # TypeScript по всем пакетам
pnpm test        # unit-тесты (без БД)
pnpm --filter @agromoll/api test:e2e  # e2e: нужна БД + Redis (REDIS_URL)
pnpm build       # сборка пакетов, api и web-экспорт mobile
pnpm format      # Prettier
```

CI (`.github/workflows/ci.yml`):

- **quality** — lint/typecheck/unit/e2e/build; e2e идёт против
  service-контейнеров `postgis/postgis:16-3.4` и `redis:7-alpine`
  (миграции применяются перед прогоном);
- **stack** — `docker compose` целиком, миграции + проверка `prisma migrate diff`
  (миграции обязаны точно соответствовать `schema.prisma`) + PostGIS/Redis.

## Дизайн-система

Токены и компоненты живут в `packages/ui` (см. [ADR-002](docs/adr/ADR-002-design-system.md)):

- **Философия**: приложение используется в 4 утра, на улице, в спешке и перчатках —
  крупная типографика, тач-зоны от 48×48, минимум текста.
- **Цвета**: тёплый нейтральный фон (не слепит в темноте), тёмно-зелёный акцент,
  мягкий янтарный для срочности. Красный запрещён.
- **Тёмная тема** — с первого дня, следует системе + ручной переключатель на каждом экране.
- **Анимации**: 200–300 мс, spring-отклик на нажатиях (Reanimated), haptics на
  ключевых действиях.

Скриншоты и обоснование палитры: [docs/design/palette.md](docs/design/palette.md).

## Архитектурные решения

| ADR                                              | Тема                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [ADR-001](docs/adr/ADR-001-tech-stack.md)        | Технологический стек (Expo, NestJS, Prisma, PostGIS, Redis)     |
| [ADR-002](docs/adr/ADR-002-design-system.md)     | Дизайн-система: токены, палитра, тёмная тема, тактильность      |
| [ADR-003](docs/adr/ADR-003-monorepo.md)          | Монорепозиторий: pnpm workspaces + Turborepo                    |
| [ADR-004](docs/adr/ADR-004-booking-model.md)     | Модель бронирования: статусы, резерв, TTL 30 минут              |
| [ADR-005](docs/adr/ADR-005-visual-components.md) | Визуальные компоненты v0.2.0: Skeleton, EmptyState, TabBar      |
| [ADR-006](docs/adr/ADR-006-offline-core.md)      | Офлайн-ядро: outbox, идемпотентность, конфликты                 |
| [ADR-007](docs/adr/ADR-007-auth.md)              | Аутентификация: телефон + JWT, rate limit, безопасность MVP     |

## Ветвление и коммиты

- `main` — стабильная ветка, push только после зелёного CI (через PR).
- `feature/*` — ветки задач.
- Коммиты — [Conventional Commits](https://www.conventionalcommits.org/ru/): `feat:`, `fix:`, `docs:`, `chore:`, `ci:` …

## Что дальше (v0.4.0)

- Долги (табель учёта часов 289-ФЗ) поверх офлайн-ядра (create_debt уже в enum)
- Выкуп брони и приёмка товара (confirm_delivery)
- SMS-провайдер вместо dev-заглушки «0000»
- Revocation-список refresh-токенов (выход «со всех устройств»)
- Чистка старых строк outbox_operations по возрасту
- Геозоны рынка (PostGIS), доставка попутчиками
- EAS Build + expo-updates
