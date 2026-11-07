/**
 * NotificationCenter — клиентская часть push-уведомлений (v0.6.0-A, ADR-031).
 *
 * Обязанности (монтируется один раз в AppShell, только после входа):
 *  1. Регистрация push-канала при входе: native — expo-notifications,
 *     web — Web Push (service worker + VAPID). Отказ — не ошибка.
 *  2. Поллинг GET /notifications/me (30 с): гарантированный in-app канал
 *     работает даже без Firebase/ключей — push лишь ускоряет отклик.
 *  3. Новые уведомления → тост (Toast из дизайн-системы) + version-bump:
 *     экраны перечитывают данные (push — сигнал, не источник).
 *  4. Тап по тосту → deep link к объекту (booking/delivery/debt).
 *  5. Мягкий баннер «Включите уведомления» при отказе в разрешении —
 *     с кнопкой «Настроить», закрывается навсегда (не блокирует).
 *
 * Поллинг — осознанный компромисс ADR-031: web-экспорт (демо-платформа)
 * живёт без VAPID-ключей; 30 с достаточно для статусов доставки.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text, Toast, useTheme } from '@agromoll/ui';
import type { NotificationDto } from '@agromoll/types';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { isPushSupported, registerPush } from '@/lib/push/register-push';
import { useNotificationStore } from '@/store/notifications';
import { useAuthStore } from '@/store/auth';
import type { NotificationSignal } from '@/store/notifications';
import { isNotificationBannerDismissed, markNotificationBannerDismissed } from '@/lib/first-run';

/** Интервал поллинга in-app канала (мс). */
const POLL_INTERVAL_MS = 30_000;

/** Deep link: тип уведомления → маршрут expo-router (экспорт для тестов). */
export function mapNotificationRoute(notification: {
  type: string;
  data?: Record<string, unknown> | null;
}): string | null {
  switch (notification.type) {
    case 'booking_counter_offered':
    case 'booking_confirmed':
    case 'booking_cancelled':
    case 'booking_delivery_confirmed':
    case 'booking_delivery_disputed':
      return '/(buyer)/bookings';
    case 'delivery_assigned':
    case 'delivery_started':
    case 'delivery_delivered':
    case 'delivery_cancelled':
      return '/(buyer)/delivery';
    case 'debt_reminder':
      return '/(buyer)/debts';
    case 'reputation_score_dropped':
      return '/reputation';
    // v0.6.0-C (ADR-033): события арбитража ведут в кейсы.
    case 'dispute_opened':
    case 'dispute_message':
    case 'dispute_assigned':
    case 'dispute_resolved':
      return '/disputes';
    // v0.6.0-E (ADR-035): события апелляций. Сторона пары видит блокировку
    // на экране часов, арбитр — очередь в арбитраже; развязка по роли —
    // в resolveRoute (mapNotificationRoute роли не знает).
    case 'appeal_opened':
    case 'appeal_assigned':
    case 'appeal_resolved':
      return '/appeal';
    default:
      return null;
  }
}

/**
 * Маршрут с учётом роли (v0.6.0-E, ADR-035):
 *  - споры арбитру важнее в очереди арбитража (ADR-033);
 *  - апелляции: арбитру — в арбитраж, паре — на «свой» экран часов
 *    (там карточка пары с блокировкой и статусом обжалования).
 */
export function resolveNotificationRoute(route: string | null): string | null {
  if (!route) {
    return null;
  }
  const role = useAuthStore.getState().user?.role;
  if (route === '/disputes' && role === 'arbitrator') {
    return '/arbitration';
  }
  if (route === '/appeal') {
    if (role === 'arbitrator') {
      return '/arbitration';
    }
    return role === 'seller' ? '/(seller)/hours' : '/(driver)/hours';
  }
  return route;
}

/** DTO → сигнал для тоста. */
export function toSignal(dto: NotificationDto): NotificationSignal {
  return {
    id: dto.id,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    data: dto.data,
  };
}

/** Поднять баннер «включите уведомления», если отказ не выключен навсегда. */
async function shouldShowPermissionBanner(): Promise<boolean> {
  return !(await isNotificationBannerDismissed());
}

export function NotificationCenter() {
  const router = useRouter();
  const { colors, mode } = useTheme();
  const last = useNotificationStore((s) => s.last);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const receive = useNotificationStore((s) => s.receive);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  /** id последнего увиденного уведомления (первый поллинг — тишина). */
  const seenId = useRef<string | null>(null);
  /** Баннер разрешений: показывается только при отказе (ADR-031). */
  const [permissionBanner, setPermissionBanner] = useState(false);

  // ── 1. Регистрация push-канала (один раз после монтирования) ─────────────
  useEffect(() => {
    let cancelled = false;
    const register = async (): Promise<void> => {
      try {
        if (!isPushSupported()) {
          return;
        }
        // Платформенная реализация (.ts — web, .native.ts — expo-notifications)
        // даёт одинаковый API (ADR-023/031): потребитель платформы не знает.
        const result = await registerPush({
          subscribe: (input) => api.registerPush(input),
          ...(Platform.OS === 'web' ? { getVapidKey: () => api.vapidPublicKey() } : {}),
        });
        if (cancelled) {
          return;
        }
        // Отказ в разрешении → мягкий баннер (если не выключен ранее).
        if (!result.permissionGranted && !result.registered) {
          if (await shouldShowPermissionBanner()) {
            setPermissionBanner(true);
          }
        }
      } catch (error) {
        logger.warn('push', 'регистрация push не удалась (продолжаем)', {
          error: String(error),
        });
      }
    };
    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 2. Поллинг in-app канала: новые уведомления → тост + refetch-сигнал ──
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const { items, unreadCount } = await api.notifications();
        if (cancelled) {
          return;
        }
        setUnreadCount(unreadCount);
        if (items.length === 0) {
          return;
        }
        const newest = items[0];
        if (seenId.current === null) {
          // Первый поллинг сессии — фиксируем «линию фронта», тост не нужен:
          // старые уведомления пользователь увидит в списке, не в тостах.
          seenId.current = newest.id;
          return;
        }
        // items отсортированы desc: всё, что новее seenId — «свежие».
        if (newest.id === seenId.current) {
          return;
        }
        const fresh = items.filter((item) => item.id !== seenId.current);
        seenId.current = newest.id;
        receive(fresh.map(toSignal), unreadCount);
      } catch {
        // Сеть легла — следующий тик через 30 с (тихо, ADR-031).
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [receive, setUnreadCount]);

  // ── 3. Deep link из service worker (web): вкладку сфокусировали тапом ───
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return undefined;
    }
    const onMessage = (event: MessageEvent): void => {
      const route = (event.data as { type?: string; route?: string | null })?.route;
      if (route) {
        const resolved = resolveNotificationRoute(route);
        if (resolved) {
          router.push(resolved as never);
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  // ── Тост: тап → deep link ────────────────────────────────────────────────
  const handleToastPress = useCallback((): void => {
    if (last) {
      const route = mapNotificationRoute(last);
      const resolved = resolveNotificationRoute(route);
      if (resolved) {
        router.push(resolved as never);
      }
    }
    dismiss();
  }, [last, router, dismiss]);

  const hideBanner = useCallback(async (): Promise<void> => {
    setPermissionBanner(false);
    await markNotificationBannerDismissed();
  }, []);

  /** «Настроить»: web — запросить разрешение ещё раз; native — пользователь
   *  сам откроет настройки ОС, если запретил навсегда; баннер закрываем. */
  const handleEnablePress = useCallback((): void => {
    void hideBanner();
    if (
      Platform.OS === 'web' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      void Notification.requestPermission();
    }
  }, [hideBanner]);

  const showBanner = permissionBanner && !last;

  return (
    <>
      {last ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            paddingHorizontal: 16,
            paddingTop: 12,
          }}
        >
          <Toast
            title={last.title}
            body={last.body}
            onPress={handleToastPress}
            onDismiss={dismiss}
          />
        </View>
      ) : null}
      {showBanner ? (
        <View
          accessibilityRole="alert"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 90,
            paddingHorizontal: 16,
            paddingTop: 12,
          }}
        >
          <View
            style={{
              padding: 12,
              borderRadius: 16,
              gap: 12,
              backgroundColor: colors.warning + '2E',
              borderWidth: 1,
              borderColor: mode === 'dark' ? colors.borderStrong : 'transparent',
            }}
          >
            <View style={{ gap: 4 }}>
              <Text variant="caption" weight="600" color="onWarning">
                Включите уведомления
              </Text>
              <Text variant="caption" color="onWarning">
                Статусы броней и доставок будут приходить сразу. Настроить можно в любой момент.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Настроить" size="md" onPress={handleEnablePress} />
              <Button
                title="Позже"
                size="md"
                variant="secondary"
                onPress={() => void hideBanner()}
              />
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}
