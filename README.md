# АгроМолл · АгроМолл

[![CI](https://github.com/bolqor83-crypto/agromoll/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bolqor83-crypto/agromoll/actions/workflows/ci.yml)

Мобильное приложение оптово-розничного рынка в Ростове-на-Дону. Рынок работает
с 4:00 до 14:00; три роли — **покупатель** (владелец ларька), **продавец** (оптовик),
**доставщик** (попутчик). Приложение заточено на раннее утро: крупный спокойный UI,
тёмная тема, зоны нажатия под перчатки, язык рынка вместо языка софта.

> **Статус — этап 1: каркас и дизайн-система.**
> Бизнес-логика (брони, долги, учёт часов, доставки, аутентификация) на этом этапе
> НЕ реализована — см. [Дорожную карту](#дорожная-карта).

## Стек

| Слой | Технологии |
| --- | --- |
| Mobile | React Native · Expo SDK 53 · Expo Router 5 · TypeScript · Zustand · Reanimated 3 · react-native-safe-area-context |
| API | NestJS 11 · TypeScript · Prisma 6 · pino (структурированные логи) |
| БД | PostgreSQL 16 + PostGIS (расширение заложено в первой миграции) · Redis 7 (заложен в docker-compose) |
| Пакеты | `@agromoll/ui` (дизайн-система) · `@agromoll/types` (общие типы) · `@agromoll/validation` (zod) |
| Инфраструктура | pnpm workspaces · Turborepo · docker-compose · GitHub Actions |

## Структура

```
agromoll/
├── apps/
│   ├── mobile/          # Expo-приложение: экраны Покупатель/Продавец/Доставщик
│   └── api/             # NestJS: /health, заглушка auth, Prisma
├── packages/
│   ├── ui/              # Дизайн-система: токены + Screen/Text/Button/Card/Input/Badge
│   ├── types/           # Общие типы (Role, HealthCheckResponse, …)
│   └── validation/      # zod-схемы
├── docs/
│   ├── adr/             # ADR-001 стек · ADR-002 дизайн · ADR-003 монорепо
│   └── design/          # Палитра и скриншоты
├── docker-compose.yml   # PostgreSQL + PostGIS, Redis
├── turbo.json
└── pnpm-workspace.yaml
```

## Быстрый старт

Требования: **Node 20.18+ (рекомендуется 22)**, **pnpm 10+** (`npm i -g pnpm`),
**Docker** (для БД).

```bash
# 1. Установить зависимости (prisma generate выполнится автоматически)
pnpm install

# 2. Поднять инфраструктуру: PostgreSQL+PostGIS и Redis
docker compose up -d

# 3. Применить миграции (создаёт расширение PostGIS и таблицу users)
pnpm db:deploy

# 4. Запустить api (:3000) и mobile (:8081) одной командой
pnpm dev
```

Проверка:

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"agromoll-api","version":"0.1.0",...}
```

Мобильное приложение: откройте **Expo Go** на телефоне и отсканируйте QR из
терминала, либо запустите веб-версию: `pnpm --filter @agromoll/mobile web`.
В приложении: экран выбора роли → Покупатель / Продавец / Доставщик,
переключатель темы (🌙/☀️) — в шапке каждого экрана.

## Переменные окружения

Скрипты читают корневой `.env` (шаблон — `.env.example`):

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | Строка подключения PostgreSQL для api/Prisma |
| `POSTGRES_USER/PASSWORD/DB` | Учётные данные docker-compose |
| `REDIS_URL` | Зарезервировано на следующие этапы |
| `PORT`, `LOG_LEVEL` | api: порт и уровень логирования |
| `EXPO_PUBLIC_API_URL` | Адрес api для мобильного клиента |

Секреты (например, `GITHUB_TOKEN` для локальных скриптов публикации) храните
только в `.env` — файл в `.gitignore`.

## Скрипты

| Команда | Что делает |
| --- | --- |
| `pnpm dev` | api (`nest start --watch`) + mobile (`expo start`) параллельно |
| `pnpm check` | lint → typecheck → test → build по всем пакетам (то же, что CI) |
| `pnpm lint` / `typecheck` / `test` / `build` | Отдельные задачи Turborepo |
| `pnpm db:up` / `db:down` | Поднять/остановить docker-compose |
| `pnpm db:migrate` | Создать миграцию (`prisma migrate dev`) |
| `pnpm db:studio` | Prisma Studio |

## Дизайн-система

Токены — в `packages/ui/src/tokens.ts` (цвета light/dark, типографика, отступы
4/8/12/16/24/32, скругления 12/16/20/pill, движение 200/300 мс, мягкие тени).
Обоснование палитры — [docs/design/palette.md](docs/design/palette.md), решение —
[ADR-002](docs/adr/ADR-002-design-system.md). Ключевое: тёплый нейтральный фон,
тёмно-зелёный акцент, **красный запрещён** — срочность передаётся мягким янтарным.

Компоненты: `Screen` (safe-area + шапка), `Text`, `Button` (spring-отклик, 56/48 px),
`Card`, `Input` (56 px), `Badge` (нейтральный/зелёный/янтарный).

## CI

GitHub Actions (`.github/workflows/ci.yml`): на каждый PR и push в `main` —
`pnpm install --frozen-lockfile` → `pnpm check`. Секреты не нужны.

## Документация

- [ADR-001: технологический стек](docs/adr/ADR-001-tech-stack.md)
- [ADR-002: дизайн-система](docs/adr/ADR-002-design-system.md)
- [ADR-003: монорепозиторий](docs/adr/ADR-003-monorepo.md)
- [Палитра и скриншоты](docs/design/palette.md)

## Дорожная карта

Этап 2 (следующий):

1. Аутентификация: вход по телефону, роли buyer/seller/driver (модуль auth).
2. Пакеты: dist-сборка `packages/*` и подключение их в api.
3. Заявки покупателя: каталог, корзина-заявка, статусы.
4. Прайсы продавца: CRUD товаров и цен.
5. Доставки: попутные маршруты, геозоны рынка (PostGIS).
6. Redis: кэш прайсов, статусы доставщиков online.
7. Иконки/сплэш приложения, EAS-сборки, ветка защиты main.
