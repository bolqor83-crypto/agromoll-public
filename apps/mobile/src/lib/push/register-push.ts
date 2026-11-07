/**
 * Регистрация push-канала (v0.6.0-A, ADR-031) — web-реализация.
 *
 * Web Push API: service worker (public/sw.js) + PushManager.subscribe
 * с публичным VAPID-ключом сервера (GET /notifications/vapid-public).
 * Ключ не вшит в бандл: сервер ротирует его без пересборки.
 *
 * Платформенное разделение — как gesture-handler-boot (ADR-023):
 * .native.ts тянет expo-notifications только в нативный бандл, web
 * не платит за нативный SDK. Обе реализации дают ОДИНАКОВЫЙ API
 * (registerPush / isPushSupported / getPushPermission) — потребитель
 * (NotificationCenter) не знает о платформе.
 */
import type { PushPermission, RegisterPushDeps, RegisterPushResult } from './push-shared';

/** Поддерживает ли браузер Web Push (Safari < 16.4 — нет, это норма). */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Текущее разрешение на уведомления. */
export function getPushPermission(): PushPermission {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

/** base64url → Uint8Array для applicationServerKey (VAPID). */
function urlBase64ToBytes(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/**
 * Зарегистрировать web push: разрешение → service worker → подписка →
 * POST /notifications/register. Отказ пользователя — НЕ ошибка:
 * приложение продолжает работать, in-app канал остаётся (ADR-031).
 *
 * Сигнатура идентична native-версии (register-push.native.ts):
 * getVapidKey опционален — без него канал просто не настроен.
 */
export async function registerPush(options: RegisterPushDeps): Promise<RegisterPushResult> {
  if (!isPushSupported()) {
    return { registered: false, permissionGranted: false, reason: 'not_supported' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    // Запрос разрешения — сразу после входа (ADR-031): до входа
    // спрашивать бессмысленно.
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { registered: false, permissionGranted: false, reason: 'no_permission' };
  }

  const vapidKey = options.getVapidKey ? await options.getVapidKey() : null;
  if (!vapidKey) {
    // Сервер не настроен (dev/CI без ключей) — молча пропускаем.
    return { registered: false, permissionGranted: true, reason: 'not_configured' };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(vapidKey) as unknown as BufferSource,
      }));

    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return { registered: false, permissionGranted: true, reason: 'error' };
    }

    await options.subscribe({
      platform: 'web',
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
    return { registered: true, permissionGranted: true };
  } catch {
    // Сеть/браузер отказали — тихо: push вспомогательный канал (ADR-031).
    return { registered: false, permissionGranted: true, reason: 'error' };
  }
}
