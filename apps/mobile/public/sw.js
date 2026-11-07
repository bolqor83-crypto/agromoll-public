/*
 * Service worker АгроМолл (v0.6.0-A, ADR-031) — Web Push на web-экспорте.
 *
 * Expo web отдаёт файлы из public/ как статические, sw.js регистрируется
 * из src/lib/push/register-push.ts. Обязан быть NO-OP для fetch: кэширование
 * офлайн-ядра не входит в его обязанности (ADR-006 — очередь в AsyncStorage),
 * перехватывать запросы нельзя, иначе API начнёт отвечать из кэша.
 */

self.addEventListener('install', () => {
  // Активируемся сразу, не ждём закрытия старых вкладок.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push от сервера: JSON { title, body, data } (шлёт WebPushTransport).
 * Показываем системное уведомление; data с type/bookingId/… — маршрут
 * перехода по тапу (deep link: push — сигнал, не источник данных).
 */
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'АгроМолл', body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'АгроМолл', {
      body: payload.body || '',
      tag: 'agromoll-push',
      renotify: true,
      data: payload.data || {},
    }),
  );
});

/**
 * Тап по уведомлению: открыть/сфокусировать окно и перейти к объекту.
 * Маршрут — по типу уведомления (data.type) в SPA-роутинге expo-router.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const route = routeForNotification(data);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Уже открытое окно — фокус + переход (postMessage слушает приложение).
      for (let i = 0; i < clientList.length; i += 1) {
        const client = clientList[i];
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'agromoll:navigate', route });
          return undefined;
        }
      }
      // Окна нет — открываем с маршрутом в hash (приложение прочитает при старте).
      return self.clients.openWindow(route ? `/#${route}` : '/');
    }),
  );
});

/** Маршрут по типу уведомления — зеркально mapNotificationRoute в приложении. */
function routeForNotification(data) {
  // v0.6.0-C (ADR-033): события арбитража ведут в кейсы споров.
  if (data.disputeId) {
    return '/disputes';
  }
  if (data.bookingId) {
    return '/(buyer)/bookings';
  }
  if (data.deliveryId) {
    return '/(buyer)/delivery';
  }
  if (data.debtId) {
    return '/(buyer)/debts';
  }
  return null;
}
