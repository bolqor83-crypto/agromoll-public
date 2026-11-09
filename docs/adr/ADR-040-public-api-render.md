# ADR-040: Публичный API — Render + Neon (вместо Railway)

- Статус: **Принято, реализовано** (деплой 2026-11-09, `https://agromoll-api.onrender.com`, deploy `dep-dboblltg` — live); v0.8.1-D закрыт 09.11.2026 — зеркало стало постоянным источником деплоя (п. 7)
- Дата: 2026-11-07 (Railway) / 2026-11-09 (перенос на Render) / 2026-11-09 (зеркало — постоянно)
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

## Найденное при деплое (v0.8.1-B, деплой 09.11.2026)

### 1. Приватный репозиторий — только через GitHub App

`POST /v1/services` с `repo: <приватный репозиторий>` → 400 «passed in
repository URL is invalid or unfetchable» (токен в URL не поддерживается,
формат жёстко `github.com/{ns}/{repo}`). Без установленного на аккаунт
GitHub App Render клонирует только публичные репозитории. Решение —
**публичное зеркало** `bolqor83-crypto/agromoll-public` (main + ветки):
перед пушем проведён аудит секретов всей git-истории (скрипт сканирует
рев-лист объектов по паттернам napi_/rnd_/rlwy_/ghp_/AKIA/…/строки
подключения; найдены только плейсхолдеры `agromoll:agromoll@localhost`
из CI/testcontainers). Зеркало синхронизируется пушем из основного репо;
после подключения GitHub App сервис переключается на основной репозиторий
(PATCH `repo`/`branch`).

### 2. NODE_ENV=production на этапе билда ломает pnpm-install

Render задаёт `NODE_ENV=production` **во время билда** → pnpm 9 молча
пропускает devDependencies («devDependencies: skipped because NODE_ENV is
set to production», exit 0, ~2 сек): нет turbo/nest/prisma-CLI →
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL «Command turbo/nest not found»`.
Диагноз занял 6 итераций деплоя (логи через `GET /v1/logs?type=build`).
Дополнительно `NPM_CONFIG_CACHE`/`NPM_CONFIG_STORE_DIR=/opt/render/.cache`
ломают кэш npx (pnpm читает NPM_CONFIG_*).

Рабочая конфигурация (воспроизведена локально перед патчем):

```yaml
buildCommand: rm -rf node_modules && env -u NPM_CONFIG_CACHE -u NPM_CONFIG_STORE_DIR \
  -u NPM_CONFIG_LOGLEVEL npx pnpm@9.15.9 install --frozen-lockfile --prod=false \
  && npx pnpm@9.15.9 -w exec turbo run build --filter=@agromoll/api
startCommand: node node_modules/prisma/build/index.js migrate deploy \
  --schema apps/api/prisma/schema.prisma && node apps/api/dist/src/main.js
```

Почему так: `--prod=false` ставит devDependencies (turbo/nest/prisma);
`pnpm -w exec turbo` — бинарь turbo лежит в корневом `node_modules/.bin`
(node-linker=hoisted из .npmrc — плоская установка ради Expo/Metro), а
рекурсивный `pnpm turbo` его не находит; prisma-CLI на старте вызывается
прямым путём — рантайм снова в NODE_ENV=production, и pnpm-обёртка могла
бы срезать devDependencies. `rm -rf node_modules` — страховка от
частично-связанных деревьев с прошлых билдов.

### 3. Миграции: попытка в контейнере не удалась — осталось «из окружения агента»

Для автодеплоя миграции пробовали в `startCommand` (деплой `dep-dboblltg`
так и вышел в live): но при повторном деплое `dep-dbobs8aj` `migrate
deploy` по pooled-строке упал **P1002** — advisory lock Prisma не
берётся через PgBouncer в transaction-режиме за 10 сек (гонка со сканом
портов контейнера). Перенос в buildCommand тоже не работает: секретные
env-переменные Render не подставляются в билд-команду (`dep-dbobthaj`,
**P1012** — пустой `DATABASE_URL`). Итоговая схема — как задумано выше:
`startCommand: node apps/api/dist/src/main.js`, схема и сид применяются
из окружения агента по direct-строке; новые миграции — ручной шаг при
релизе (fail-fast на билде контейнера не нужен: `migrate deploy`
идемпотентен, расхождение исключено).

### 4. Автодеплой из зеркала — только ручной триггер

GitHub-webhook на зеркало Render создать не может (зеркало пушится
токеном без admin:repo_hook), поэтому `autoDeploy: true` не срабатывает
сам — деплой запускается `POST /v1/services/{id}/deploys` (или кнопкой
Manual Deploy). После подключения GitHub App и переключения сервиса на
основной репозиторий webhook появится и автодеплой заработает.

### 5. GitHub App на стороне GitHub ≠ доступ для workspace Render (09.11.2026)

После добавления `agromoll` в Repository Access установленного на
GitHub-аккаунте `bolqor83-crypto` GitHub App «Render» (GitHub → Settings →
Installations → Render → Configure) PATCH `/v1/services/{id}` и POST
`/v1/services` с `repo: github.com/bolqor83-crypto/agromoll` продолжали
отдавать 400 «repository URL is invalid or unfetchable» — 30+ попыток
за 25 минут (включая диагностическое создание пробного сервиса;
GitHub-сторона проверена и в порядке: репо приватное, PAT с admin).
Прод не пострадал: сервис остался на зеркале (live, `/health` 200).

Вывод: доступ Render к приватному репо определяется не фактом установки
App на GitHub, а связкой «установка App ↔ аккаунт Render» (dashboard →
Account Settings → Connections). Если установка linked на другой
Render-аккаунт (или коннект привязан к другому GitHub-профилю), workspace
`bolqor's workspace` (tea-dbo9mo6c6qcc73d1mne0) репо не видит. Нужно
завершить коннект GitHub из дашборда Render под аккаунтом-владельцем
сервиса (bolqor83@gmail.com) и выбрать `agromoll` при установке App.
~~После этого — повторить `render_switch_final.py` (PATCH repo/branch +
autoDeploy), дождаться live и проверить `/health`.~~ Шаг отменён
09.11.2026 — задача закрыта без переключения (п. 7).

Дополнительно: у PAT `GITHUB_TOKEN_BOLQOR` нет scope `delete_repo`
(выданы admin:org, repo, workflow) — удаление зеркала
`agromoll-public` через API невозможно, требуется перевыпуск токена
или ручное удаление в UI. ~~Условие удаления зеркала — live-деплой из
основного репо + зелёный `/health`.~~ Отменено 09.11.2026: зеркало
не удаляется — оно постоянное (п. 7).

### 6. Эксплуатационные заметки (08–09.11.2026)

- **Инцидент Railway QBCLHG1V всё ещё активен** (проверка 08.11
  ~20:15 UTC: `platformStatus.isStable=false`, статус IDENTIFIED,
  «External network blocks affecting access to Railway») — запасной
  вариант недоступен, прод живёт на Render+Neon.
- **Крон-задача 514504** (ежедневная проверка Railway и автодеплой при
  снятии инцидента, эпоха v0.8.0-B) **деактивирована как устаревшая**:
  она деплоила бы текущую `main` (сейчас v0.7.0 — без v0.8.x) и
  переключала бы `EXPO_PUBLIC_API_URL` с Render на Railway, что
  противоречит настоящему ADR. Статус Railway проверяется вручную
  (`railway api '{ platformStatus { isStable } }'` из runbook §9)
  при рассмотрении отката.
- **Перезагрузка среды агента 08.11 20:13 UTC** затёрла локальные
  артефакты (шаблон среды откатился к состоянию ~v0.8.0-B): потеряны
  скрипты `scripts/render_*.py` (восстановлены) и секреты в
  `agromoll/.env` — `RENDER_API_KEY`, `NEON_API_KEY`,
  `NEON_PROJECT_ID`, `DATABASE_URL_DIRECT`/`_POOLED`. **Восстановлено
  09.11.2026**: ключи Render/Neon переданы владельцем в чат (ключ
  Render — из целевого workspace `tea-dbo9mo6c6qcc73d1mne0`, сервис
  виден; Neon-ключ personal — запросы требуют `org_id` из этого ADR),
  `NEON_PROJECT_ID`/`NEON_ORG_ID` — из этого ADR, `DATABASE_URL_POOLED`
  — чтением env сервиса через Render API
  (`GET /v1/services/{id}/env-vars`), `DATABASE_URL_DIRECT` —
  деривация: pooler-хост и параметры `pgbouncer`/`connection_limit`
  убраны. Облачные ресурсы не затронуты: сервис
  `srv-dbobfevf3r2c73amlng0` жив (mirror, live), проект Neon
  `silent-hill-19081344` и схема/сид на месте.

### 7. Зеркало — постоянное решение: v0.8.1-D закрыт (09.11.2026)

Продуктовое решение владельца после исчерпания диагностики (пп. 1, 5):
**переключение на приватный репозиторий отменяется, публичное зеркало
`bolqor83-crypto/agromoll-public` — постоянный источник деплоя**
`agromoll-api`. Прод стабилен и зелёный, дальнейшая диагностика
расхождения аккаунтов/workspace Render продуктовой ценности не
добавляет. Cron-ретри переключения (job 515753, one_time 01:45 MSK)
отменён в тот же день, не успев сработать.

Следствия:

- **Зеркало не удаляется** — план удаления из п. 5 отменён вместе с
  условием «live-деплой из основного репо».
- Модель релиза: изменения ветки `feature/v0.8.1-render-api` пушатся в
  оба ремоута (`git push origin … && git push mirror …`; ремоут `mirror`
  восстановлен в окружении агента после перезагрузки среды, п. 6);
  деплой — по-прежнему ручной триггер (п. 4: webhook на зеркало
  невозможен, autoDeploy сам не срабатывает).
- `render.yaml` остаётся указывать на зеркало; конфигурация живого
  сервиса не меняется.
- Если переключение понадобится в будущем, отправная точка — п. 5:
  проверить аккаунт-владелец по прямой ссылке на сервис в дашборде,
  per-service Git Deployment Credentials, API-ключ из целевого workspace.

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
