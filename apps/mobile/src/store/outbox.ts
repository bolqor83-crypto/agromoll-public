/**
 * Состояние офлайн-ядра для UI (v0.3.0, ADR-006).
 *
 *  - isOnline / syncing / pendingCount — индикатор в шапке:
 *    зелёная точка «Онлайн», янтарная «Офлайн — сохраним»,
 *    пульсирующая зелёная «Синхронизация…»;
 *  - queue — снимок очереди для экрана «Очередь»;
 *  - optimistic (pendingCreates/overrides) — оптимистичные состояния
 *    броней до подтверждения сервером;
 *  - conflictedOperation — операция с бизнес-конфликтом: UI показывает
 *    диалог «[Принять серверное] [Отменить локальную]»;
 *  - version — счётчик изменений: экраны перечитывают данные.
 *
 * Триггеры синхронизации: старт приложения, восстановление сети
 * (NetInfo), возвращение на передний план (AppState), pull-to-refresh,
 * ручная кнопка. Инициализация — initOutboxBridge() из root layout.
 */
import { create } from 'zustand';
import { AppState } from 'react-native';
import type { BookingStatus } from '@agromoll/types';
import { success, warning } from '@agromoll/ui';
import type { OutboxEvent, OutboxRecord } from '@/lib/outbox/types';
import { getOutbox } from '@/lib/outbox/outbox-instance';
import { logger } from '@/lib/logger';

/** Псевдо-карточка брони, созданной офлайн (до ответа сервера). */
export interface PendingCreate {
  listingId: string;
  listingTitle?: string;
  listingUnit?: string;
  requestedQuantity: number;
  createdAt: string;
}

/** Локальный override статуса существующей брони. */
export interface StatusOverride {
  status: BookingStatus;
  clientUuid: string;
}

interface OutboxState {
  isOnline: boolean;
  syncing: boolean;
  pendingCount: number;
  queue: OutboxRecord[];
  version: number;
  conflictedOperation: (OutboxRecord & { message: string }) | null;
  pendingCreates: Record<string, PendingCreate>;
  overrides: Record<string, StatusOverride>;

  refreshQueue: () => Promise<void>;
  runSync: () => Promise<void>;
  addPendingCreate: (clientUuid: string, create: PendingCreate) => void;
  setOverride: (bookingId: string, status: BookingStatus, clientUuid: string) => void;
  applyServerBookingStatus: (booking: { id: string; status: BookingStatus }) => void;
  resolveConflict: (resolution: 'accept-server' | 'discard-local') => Promise<void>;
  retryOperation: (clientUuid: string) => Promise<void>;
  handleOutboxEvent: (event: OutboxEvent) => void;
}

export const useOutboxStore = create<OutboxState>((set, get) => ({
  isOnline: true,
  syncing: false,
  pendingCount: 0,
  queue: [],
  version: 0,
  conflictedOperation: null,
  pendingCreates: {},
  overrides: {},

  refreshQueue: async () => {
    try {
      const outbox = await getOutbox();
      const [queue, pendingCount] = await Promise.all([outbox.list(), outbox.pendingCount()]);
      set({ queue, pendingCount });
    } catch (error) {
      logger.warn('outbox', 'не удалось прочитать очередь', { error: String(error) });
    }
  },

  runSync: async () => {
    const { isOnline, syncing } = get();
    if (!isOnline || syncing) {
      return;
    }
    set({ syncing: true });
    try {
      const outbox = await getOutbox();
      const summary = await outbox.processQueue();
      if (summary.completed + summary.failed + summary.conflicted > 0) {
        set((s) => ({ version: s.version + 1 }));
      }
      // Очередь опустела после работы — мягкий сигнал успеха (ADR-009).
      if (summary.completed > 0 && summary.conflicted === 0) {
        success();
      }
      await get().refreshQueue();
    } catch (error) {
      logger.warn('outbox', 'синхронизация не удалась', { error: String(error) });
    } finally {
      set({ syncing: false });
    }
  },

  addPendingCreate: (clientUuid, create) => {
    set((s) => ({
      pendingCreates: { ...s.pendingCreates, [clientUuid]: create },
      pendingCount: s.pendingCount + 1,
    }));
  },

  setOverride: (bookingId, status, clientUuid) => {
    set((s) => ({
      overrides: { ...s.overrides, [bookingId]: { status, clientUuid } },
      pendingCount: s.pendingCount + 1,
    }));
  },

  /** Серверная бронь подтверждена — убираем оптимистичный override. */
  applyServerBookingStatus: (booking) => {
    set((s) => {
      if (!s.overrides[booking.id]) {
        return s;
      }
      const overrides = { ...s.overrides };
      delete overrides[booking.id];
      return { ...s, overrides };
    });
  },

  resolveConflict: async (resolution) => {
    const conflicted = get().conflictedOperation;
    if (!conflicted) {
      return;
    }
    try {
      const outbox = await getOutbox();
      await outbox.resolveConflict(conflicted.clientUuid, resolution);
    } finally {
      set((s) => {
        // убрать конфликт и связанные оптимистичные состояния
        const pendingCreates = { ...s.pendingCreates };
        delete pendingCreates[conflicted.clientUuid];
        const overrides: Record<string, StatusOverride> = {};
        for (const [bookingId, override] of Object.entries(s.overrides)) {
          if (override.clientUuid !== conflicted.clientUuid) {
            overrides[bookingId] = override;
          }
        }
        return {
          conflictedOperation: null,
          pendingCreates,
          overrides,
          version: resolution === 'accept-server' ? s.version + 1 : s.version,
        };
      });
      await get().refreshQueue();
    }
  },

  retryOperation: async (clientUuid) => {
    const outbox = await getOutbox();
    await outbox.retryManually(clientUuid);
    await get().refreshQueue();
    void get().runSync();
  },

  handleOutboxEvent: (event) => {
    switch (event.type) {
      case 'completed': {
        const { record } = event;
        set((s) => {
          const pendingCreates = { ...s.pendingCreates };
          delete pendingCreates[record.clientUuid];
          const overrides: Record<string, StatusOverride> = {};
          for (const [bookingId, override] of Object.entries(s.overrides)) {
            if (override.clientUuid !== record.clientUuid) {
              overrides[bookingId] = override;
            }
          }
          return { pendingCreates, overrides, version: s.version + 1 };
        });
        void get().refreshQueue();
        break;
      }
      case 'conflicted': {
        set({
          conflictedOperation: {
            ...event.record,
            message: event.record.lastError ?? 'Конфликт с сервером',
          },
        });
        // Конфликт решает человек — мягкий сигнал внимания (ADR-009).
        warning();
        void get().refreshQueue();
        break;
      }
      case 'permanently-failed': {
        void get().refreshQueue();
        break;
      }
      default:
        void get().refreshQueue();
        break;
    }
  },
}));

let bridgeInitialized = false;

/**
 * Связать outbox с внешним миром: события, сеть, передний план.
 * Вызывается один раз из root layout (idempotent).
 */
export async function initOutboxBridge(): Promise<() => void> {
  if (bridgeInitialized) {
    return () => undefined;
  }
  bridgeInitialized = true;

  const outbox = await getOutbox();

  const offEvent = outbox.on((event) => {
    useOutboxStore.getState().handleOutboxEvent(event);
  });

  // Сеть: восстановление → сразу синхронизация.
  // NetInfo импортируется динамически: его web-модуль читает window на
  // этапе загрузки, что ломает статический рендер expo export (SSG в Node).
  const { default: NetInfo } = await import('@react-native-community/netinfo');
  const unsubscribeNet = NetInfo.addEventListener((state) => {
    // isConnected=false покрывает none/unknown; isInternetReachable
    // отсеивает «подключено, но интернета нет» (например, Wi-Fi без шлюза).
    const isOnline = state.isConnected === true && state.isInternetReachable !== false;
    const wasOnline = useOutboxStore.getState().isOnline;
    useOutboxStore.setState({ isOnline });
    if (!wasOnline && isOnline) {
      logger.info('outbox', 'сеть восстановлена — синхронизируем очередь');
      void useOutboxStore.getState().runSync();
    }
  });

  // Передний план: догоняем очередь (пока приложение «спало», могла
  // появиться сеть или данные могли измениться на сервере).
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void useOutboxStore.getState().runSync();
    }
  });

  // Первый снимок очереди и стартовая синхронизация.
  await useOutboxStore.getState().refreshQueue();
  void useOutboxStore.getState().runSync();

  return () => {
    offEvent();
    unsubscribeNet();
    appStateSubscription.remove();
    bridgeInitialized = false;
  };
}
