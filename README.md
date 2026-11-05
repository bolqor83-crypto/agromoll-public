# АгроМолл

Мобильное приложение для оптово-розничного рынка «Агро Молл» (Ростов-на-Дону).
**Текущий этап — «фундамент»**: каркас монорепозитория, дизайн-система и окружение.
Бизнес-логика (брони, долги, учёт часов, доставка) — на следующих этапах.

[![CI](https://github.com/bolqor83-crypto/agromoll/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bolqor83-crypto/agromoll/actions/workflows/ci.yml)

## Стек

| Слой     | Технологии                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Mobile   | React Native (Expo SDK 52), Expo Router 4, TypeScript, Zustand, Reanimated 3, react-native-safe-area-context  |
| API      | NestJS 11, TypeScript, Prisma 6, pino (структурированные логи)                                                |
| БД       | PostgreSQL 16 + PostGIS 3.4 (миграция с расширением — с первого дня), Redis 7 (заложен, пока не используется) |
| Монорепо | pnpm workspaces + Turborepo, ESLint 9, Prettier, GitHub Actions                                               |
| Пакеты   | `packages/types` (общие типы), `packages/validation` (zod), `packages/ui` (дизайн-система)                    |

## Структура

```
agromoll/
  apps/
    mobile/          — Expo-приложение: 3 экрана-заглушки (Покупатель / Продавец / Доставщик)
    api/             — NestJS: /health + заглушка модуля auth + Prisma (User с ролью)
  packages/
    ui/              — дизайн-система: токены, темы и компоненты Button, Card, Input, Badge, Screen, Text
    types/           — общие типы (UserRole, HealthResponse, ...)
    validation/      — zod-схемы (пока только базовые)
  docs/
    adr/             — архитектурные решения (ADR-001 стек, ADR-002 дизайн, ADR-003 монорепо)
    design/          — обоснование палитры и скриншоты экранов
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
#    (миграция создаёт расширение PostGIS и таблицу users)
pnpm db:generate
pnpm db:migrate

# 5. Собрать пакеты (types, validation, ui) — их нужны api и mobile
pnpm build

# 6. Запустить всё
pnpm dev
```

После запуска:

- API: `http://localhost:3000/health` — healthcheck
- Mobile (Expo): `http://localhost:8081` — Metro-сервер (w — web, a — Android, i — iOS)

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
pnpm test        # unit- и e2e-тесты
pnpm build       # сборка пакетов, api и web-экспорт mobile
pnpm format      # Prettier
```

CI (`.github/workflows/ci.yml`) прогоняет то же самое на каждый PR и push в `main`,
плюс отдельно поднимает `docker compose` и применяет миграции к реальному PostGIS.

## Дизайн-система

Токены и компоненты живут в `packages/ui` (см. [ADR-002](docs/adr/ADR-002-design-system.md)):

- **Философия**: приложение используется в 4 утра, на улице, в спешке и перчатках —
  крупная типографика, тач-зоны от 48×48, минимум текста.
- **Цвета**: тёплый нейтральный фон (не слепит в темноте), тёмно-зелёный акцент,
  мягкий янтарный для срочности. Красный запрещён.
- **Тёмная тема** — с первого дня, следует системе + ручной переключатель на каждом экране.
- **Анимации**: 200–300 мс, spring-отклик на нажатиях (Reanimated).

Скриншоты и обоснование палитры: [docs/design/palette.md](docs/design/palette.md).

## Архитектурные решения

| ADR                                          | Тема                                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| [ADR-001](docs/adr/ADR-001-tech-stack.md)    | Технологический стек (Expo, NestJS, Prisma, PostGIS, Redis) |
| [ADR-002](docs/adr/ADR-002-design-system.md) | Дизайн-система: токены, палитра, тёмная тема, тактильность  |
| [ADR-003](docs/adr/ADR-003-monorepo.md)      | Монорепозиторий: pnpm workspaces + Turborepo                |

## Ветвление и коммиты

- `main` — стабильная ветка, push только после зелёного CI (через PR).
- `feature/*` — ветки задач.
- Коммиты — [Conventional Commits](https://www.conventionalcommits.org/ru/): `feat:`, `fix:`, `docs:`, `chore:`, `ci:` …

## Что дальше (следующий этап)

- Аутентификация по номеру телефона и выдача роли
- Брони и заказы (buyer/seller), долги и учёт часов
- Геозоны рынка (PostGIS), доставка попутчиками
- Redis: очередь событий, rate-limit
- EAS Build для сборок, expo-updates для OTA
