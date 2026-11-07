/**
 * Состояние уведомлений (v0.6.0-A, ADR-031).
 *
 * Push — сигнал, не источник данных (ADR-031): получив уведомление,
 * экраны перечитывают свои данные. Механизм — тот же, что у outbox:
 * version-счётчик, на который подписаны useEffect'ы экранов.
 *
 * Больше ничего: содержимое уведомлений живёт на сервере
 * (GET /notifications/me), здесь — только сигнал и счётчик непрочитанных
 * (будущий бейдж таб-бара).
 */
import { create } from 'zustand';

/** Уведомление для тоста (контекст из NotificationDto). */
export interface NotificationSignal {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
}

interface NotificationState {
  /** Растёт при каждом новом уведомлении — экраны перечитывают данные. */
  version: number;
  /** Непрочитанные (in-app) — бейдж, шапка. */
  unreadCount: number;
  /** Последнее уведомление (тост); null — ничего нового. */
  last: NotificationSignal | null;
  /** Скрыть тост (автоскрытие/тап). */
  dismiss: () => void;
  /** Зафиксировать новую партию уведомлений (bump + тост последнего). */
  receive: (items: NotificationSignal[], unreadCount: number) => void;
  /** Только обновить счётчик (поллинг без новых). */
  setUnreadCount: (unreadCount: number) => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  version: 0,
  unreadCount: 0,
  last: null,
  dismiss: () => set({ last: null }),
  receive: (items, unreadCount) =>
    set((state) => ({
      // Пустая партия — не сигнал: version не растёт (нет ложных refetch).
      version: items.length > 0 ? state.version + 1 : state.version,
      unreadCount,
      last: items.length > 0 ? items[items.length - 1] : state.last,
    })),
  setUnreadCount: (unreadCount) => set({ unreadCount }),
}));
