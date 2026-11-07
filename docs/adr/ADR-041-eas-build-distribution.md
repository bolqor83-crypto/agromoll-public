# ADR-041: EAS Build и дистрибуция нативных сборок

- Статус: **Принято** (сборка — после передачи EXPO_TOKEN, см. runbook)
- Дата: 2026-11-07
- Этап: v0.8.0 «Public Launch» (подэтап D)
- Связанные: ADR-040 (публичный API на Railway), ADR-022 (URL API
  вшивается на сборке), docs/release/v0.8.0-D-eas-runbook.md

## Контекст

Web-версия живёт на Vercel (ADR-032), но целевая аудитория рынка —
водители и ларёчники с Android-телефонами. Для демо нужен устанавливаемый
`.apk`: камера (QR-коды доставки, фото товаров/доказательств), push-уведомления
(FCM, v0.6.0) и офлайн-устойчивость заметно лучше в нативном приложении.
Локально собирать Android (Android SDK + JDK + подписи) в среде агента
нельзя — нужен облачный билдер. iOS дополнительно требует Apple Developer
($99/год) и UDID устройства для внутреннего распространения.

## Решение

### EAS Build (облачный билдер Expo), internal distribution

`apps/mobile/eas.json`:

- **preview**: `distribution: internal`, Android `buildType: apk` —
  прямая установка по ссылке EAS (install URL + QR), без сторов.
- **production**: Android `app-bundle` (для Google Play), iOS archive —
  задел на публикацию в сторы, пока не используется.
- `EXPO_PUBLIC_API_URL` задаётся в профиле сборки (ADR-022: адрес API
  вшивается в бандл на сборке — до подэтапа B в файле PLACEHOLDER,
  заменяется на домен Railway после деплоя, см. runbook).
- `appVersionSource: local` — версия 0.8.0 ведётся в git (package.json +
  app.json), а не на expo.dev: релизы привязаны к коммитам.

### Почему internal distribution, а не сторы (сейчас)

| Критерий | Internal (EAS link) | Google Play | App Store / TestFlight |
|---|---|---|---|
| Время до «можно показать» | ~15 мин после сборки | дни (ревью аккаунта разработчика $25 + первое ревью приложения) | дни + Apple Developer $99/год |
| Обновления JS (OTA) | мгновенно (ADR-042) | возможно, но ревью для нативных изменений | OTA-политика Apple требует осторожности |
| Регистрация устройства | любой, кто открыл ссылку | только тестеры трека | UDID для internal / e-mail для TestFlight |

Продукт ещё до product-market fit: аудитория демо — конкретные люди,
которым можно отправить ссылку. Сторы подключаем, когда появится поток
незнакомых пользователей (v0.9+): Google Play internal track уже описан
в `submit.production` профиля.

### Что нужно для перехода на сторы (задел)

- **Google Play**: аккаунт разработчика ($25, разовый), первый aab через
  `eas submit -p android --profile production`, заполнение листинга;
  дальше — internal → closed → production треки.
- **iOS**: Apple Developer ($99/год), сертификат распространения,
  `eas submit -p ios` в TestFlight. UDID-и устройств для internal
  distribution EAS собирает через страницу установки.

### Как обновлять собранное приложение

1. JS/TS-изменения (экраны, логика, стили) — OTA через `eas update`
   (ADR-042), без пересборки, доставляются при следующем запуске.
2. Нативные изменения (новые expo-модули, permissions, app.json: bundleId,
   иконки, версия) — новая сборка `eas build`, версия в app.json +1;
   runtimeVersion policy `appVersion` (ADR-042) разделяет каналы OTA.

## Последствия

- Зависимость от expo.dev (free tier: 15 билдов/мес на текущий момент —
  хватает для релизного темпа раз в 2–4 недели).
- Ссылка на .apk живёт на CDN Expo 30 дней на free tier: для «вечной»
  ссылки — перепубликация сборки или переход на собственный хостинг артефактов.
- Токен EXPO_TOKEN передаётся агентом для CLI и добавляется в GitHub
  Secrets для OTA-workflow (ручной шаг, см. ADR-042).
