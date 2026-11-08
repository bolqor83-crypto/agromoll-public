# PUBLIC-LINKS.md — публичные ссылки АгроМолл (v0.8.0)

> Единая точка правды «что доступно по ссылке и чего не хватает».
> Обновляется по мере передачи токенов и прохождения runbook'ов
> (RAILWAY_TOKEN → API, EXPO_TOKEN → сборка и OTA).

## Сводка

| Компонент | URL | Статус | Что нужно |
|---|---|---|---|
| Web-приложение | https://agromoll-web.vercel.app | 🟢 работает, автодеплой из `main` (ADR-032) | — |
| API | `https://agromoll-api-production-XXXX.up.railway.app` (пример) | 🔴 не опубликован | `RAILWAY_TOKEN` → [runbook B](release/v0.8.0-B-railway-runbook.md) |
| Android .apk | ссылка установки EAS (internal distribution) | 🔴 не собран | `EXPO_TOKEN` → [runbook D](release/v0.8.0-D-eas-runbook.md) |
| OTA-канал | EAS Update, ветка `production` | 🔴 не инициализирован | `EXPO_TOKEN` → `eas init` (runbook D, шаг 1) |
| Демо-вход | SMS-код «000000» | 🟡 готов в коде (`AUTH_DEMO_LOGIN`, ADR-040) | Активируется на проде вместе с API |

## Web — работает уже сейчас

- URL: **https://agromoll-web.vercel.app** — каждый мердж в `main`
  деплоится автоматически (workflow `Deploy (Vercel)`, ADR-032).
- **Важно:** до публикации API сайт показывает «Сервер не настроен» —
  это ожидаемо, а не поломка: URL API вшивается в бандл на сборке
  (ADR-022), переменная `EXPO_PUBLIC_API_URL` в Vercel задаётся вместе
  с деплоем API (runbook B, шаг 6).
- После публикации API: вход по любому демо-телефону из
  [DEMO.md](DEMO.md), код «000000» (шесть нулей).

## API — после передачи RAILWAY_TOKEN

Точная последовательность команд: [v0.8.0-B-railway-runbook.md](release/v0.8.0-B-railway-runbook.md)
(~15 минут: `railway login/init/add → variables → up → domain`).
Конфигурация в репо готова: `railway.json` (Nixpacks, миграции в
`startCommand`, healthcheck `/health`), CORS на домен Vercel, JWT-секреты
генерируются при деплое. Смоук: `curl -i https://<домен>/health` → 200.

Затем шаг 6 runbook'а: `EXPO_PUBLIC_API_URL` в Vercel → прод-редеплой
web → сайт оживает (лента, вход, брони).

## .apk и OTA — после передачи EXPO_TOKEN

- Сборка: [v0.8.0-D-eas-runbook.md](release/v0.8.0-D-eas-runbook.md) —
  `eas init` (фиксирует `projectId` в `app.json`), замена
  `PLACEHOLDER_API_URL` в `eas.json` на домен Railway, затем
  `eas build --platform android --profile preview` (10–20 минут).
- iOS требует Apple Developer ($99/год) — осознанно отложено (ADR-041).
- OTA: `EXPO_TOKEN` в GitHub Secrets (Settings → Secrets and variables →
  Actions, имя `EXPO_TOKEN`) — **ручной шаг владельца репозитория**;
  после этого workflow `OTA update (EAS)` публикует JS-бандл при каждом
  пуше в `main` (ADR-042). До добавления секрета workflow падает с
  понятным сообщением — это контроль, что обновления не пропадают
  «молча». Откат: `eas update:rollback --branch production`.

## Чек-лист «день публичного запуска»

1. Передать агенту `RAILWAY_TOKEN` → деплой API по runbook B.
2. Передать агенту `EXPO_TOKEN` → `eas init` + сборка .apk по runbook D;
   самому добавить `EXPO_TOKEN` в GitHub Secrets.
3. Смоук-прогон по [DEMO.md](DEMO.md): web → вход «000000» → лента →
   бронь → долги; `curl /health` → 200.
4. Обновить статусы в таблице выше (🟢) и прислать ссылки аудитории.

## Скриншоты полного флоу

Локальный E2E-прогон всех ролей (покупатель/продавец/водитель/арбитр,
включая споры, блокировку 289-ФЗ и апелляцию): `docs/screenshots/v0.8.0-local/`
(36 скриншотов + видео цикла покупателя).
