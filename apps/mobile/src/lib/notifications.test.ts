/**
 * Тесты клиентского слоя push-уведомлений (v0.6.0-A, ADR-031).
 *
 *  - notification-store: version-bump (сигнал refetch), тост последнего
 *    уведомления, счётчик непрочитанных, dismiss;
 *  - mapNotificationRoute: deep link по типу уведомления (booking →
 *    брони, delivery → доставка, debt → долги, reputation → рейтинг);
 *  - register-push (web-вариант): отсутствие поддержки → not_supported,
 *    отказ в разрешении → no_permission, отсутствие VAPID → not_configured.
 */
import { useNotificationStore } from '@/store/notifications';
import { useAuthStore } from '@/store/auth';
import {
  mapNotificationRoute,
  resolveNotificationRoute,
  toSignal,
} from '@/components/NotificationCenter';

// NotificationCenter тянет expo-router, api и first-run (AsyncStorage) —
// мокаем, чтобы тестировать чистые функции без рендера навигатора.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ api: {} }));
jest.mock('@/lib/push/register-push', () => ({
  isPushSupported: () => false,
  registerPush: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('notification-store (ADR-031: push — сигнал, не источник)', () => {
  beforeEach(() => {
    useNotificationStore.setState({ version: 0, unreadCount: 0, last: null });
  });

  it('receive растит version — экраны перечитывают данные', () => {
    const before = useNotificationStore.getState().version;
    useNotificationStore.getState().receive(
      [
        {
          id: 'n1',
          type: 'booking_confirmed',
          title: 'Бронь подтверждена',
          body: 'b',
          data: null,
        },
      ],
      1,
    );
    const state = useNotificationStore.getState();
    expect(state.version).toBe(before + 1);
    expect(state.unreadCount).toBe(1);
    expect(state.last).toMatchObject({ id: 'n1', title: 'Бронь подтверждена' });
  });

  it('пустая партия — version не растёт (нет ложных refetch)', () => {
    const before = useNotificationStore.getState().version;
    useNotificationStore.getState().receive([], 0);
    expect(useNotificationStore.getState().version).toBe(before);
  });

  it('dismiss убирает тост, счётчики остаются', () => {
    useNotificationStore
      .getState()
      .receive(
        [{ id: 'n2', type: 'debt_reminder', title: 'Напоминание', body: 'b', data: null }],
        3,
      );
    useNotificationStore.getState().dismiss();
    const state = useNotificationStore.getState();
    expect(state.last).toBeNull();
    expect(state.unreadCount).toBe(3);
  });

  it('setUnreadCount обновляет только счётчик', () => {
    useNotificationStore.getState().setUnreadCount(7);
    expect(useNotificationStore.getState().unreadCount).toBe(7);
    expect(useNotificationStore.getState().version).toBe(0);
  });
});

describe('mapNotificationRoute: события арбитража (v0.6.0-C, ADR-033)', () => {
  it('dispute_* → экран «Споры»', () => {
    for (const type of [
      'dispute_opened',
      'dispute_message',
      'dispute_assigned',
      'dispute_resolved',
    ]) {
      expect(mapNotificationRoute({ type, data: { disputeId: 'd1' } })).toBe('/disputes');
    }
  });
});

describe('апелляции 289-ФЗ: развязка маршрута по роли (v0.6.0-E, ADR-035)', () => {
  it('appeal_* → паре на экран часов (свою по роли), арбитру — в арбитраж', () => {
    for (const type of ['appeal_opened', 'appeal_assigned', 'appeal_resolved']) {
      expect(mapNotificationRoute({ type, data: { appealId: 'a1' } })).toBe('/appeal');
    }

    const role = (r: string): void => {
      useAuthStore.setState({
        user: { id: `u-${r}`, role: r, displayName: r, phone: '+79610000000' },
      } as never);
    };

    role('driver');
    expect(resolveNotificationRoute('/appeal')).toBe('/(driver)/hours');
    role('seller');
    expect(resolveNotificationRoute('/appeal')).toBe('/(seller)/hours');
    role('arbitrator');
    expect(resolveNotificationRoute('/appeal')).toBe('/arbitration');
    // Споры арбитру по-прежнему ведут в арбитраж (ADR-033).
    expect(resolveNotificationRoute('/disputes')).toBe('/arbitration');

    useAuthStore.setState({ user: null } as never);
  });
});

describe('mapNotificationRoute: deep link по типу (ADR-031)', () => {
  it('события броней → экран «Мои брони»', () => {
    for (const type of [
      'booking_counter_offered',
      'booking_confirmed',
      'booking_cancelled',
      'booking_delivery_confirmed',
      'booking_delivery_disputed',
    ]) {
      expect(mapNotificationRoute({ type, data: { bookingId: 'b1' } })).toBe('/(buyer)/bookings');
    }
  });

  it('события доставок → экран «Доставка»', () => {
    expect(mapNotificationRoute({ type: 'delivery_assigned', data: {} })).toBe('/(buyer)/delivery');
    expect(mapNotificationRoute({ type: 'delivery_delivered', data: {} })).toBe(
      '/(buyer)/delivery',
    );
  });

  it('долги и рейтинг → свои экраны', () => {
    expect(mapNotificationRoute({ type: 'debt_reminder', data: {} })).toBe('/(buyer)/debts');
    expect(mapNotificationRoute({ type: 'reputation_score_dropped', data: {} })).toBe(
      '/reputation',
    );
  });

  it('неизвестный тип → без перехода', () => {
    expect(mapNotificationRoute({ type: 'future_event', data: {} })).toBeNull();
  });
});

describe('toSignal: DTO → сигнал тоста', () => {
  it('прокидывает id, тип, тексты и контекст', () => {
    const signal = toSignal({
      id: 'n3',
      type: 'delivery_started',
      title: 'Водитель выехал',
      body: 'Ваш заказ в пути.',
      data: { deliveryId: 'd1' },
      readAt: null,
      createdAt: '2026-11-09T10:00:00.000Z',
    });
    expect(signal).toEqual({
      id: 'n3',
      type: 'delivery_started',
      title: 'Водитель выехал',
      body: 'Ваш заказ в пути.',
      data: { deliveryId: 'd1' },
    });
  });
});
