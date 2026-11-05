/**
 * Тесты тактильной карты (v0.3.1, ADR-009): троттлинг — не более одного
 * сигнала за 150 мс — и маппинг сигнал → тип expo-haptics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Мок expo-haptics до импорта карты: считаем вызовы по типам.
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import * as Haptics from 'expo-haptics';
import { __resetHapticsThrottle, selection, success, tap, warning } from './haptics';

const impactMock = vi.mocked(Haptics.impactAsync);
const notificationMock = vi.mocked(Haptics.notificationAsync);
const selectionMock = vi.mocked(Haptics.selectionAsync);

describe('тактильная карта (haptics map)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T08:00:00'));
    vi.clearAllMocks();
    __resetHapticsThrottle();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetHapticsThrottle();
  });

  it('tap() → impact Light', () => {
    tap();
    expect(impactMock).toHaveBeenCalledTimes(1);
    expect(impactMock).toHaveBeenCalledWith('light');
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('success() → notification Success', () => {
    success();
    expect(notificationMock).toHaveBeenCalledTimes(1);
    expect(notificationMock).toHaveBeenCalledWith('success');
  });

  it('warning() → notification Warning (не Error)', () => {
    warning();
    expect(notificationMock).toHaveBeenCalledTimes(1);
    expect(notificationMock).toHaveBeenCalledWith('warning');
  });

  it('selection() → selectionAsync', () => {
    selection();
    expect(selectionMock).toHaveBeenCalledTimes(1);
  });

  it('ТРОТТЛИНГ: не более одного сигнала за 150 мс (любого типа)', () => {
    // Сетка быстрых нажатий: 5 tap() подряд в один момент времени.
    tap();
    tap();
    tap();
    tap();
    tap();
    expect(impactMock).toHaveBeenCalledTimes(1);

    // Другой тип сигнала в это же окно — тоже поглощён троттлингом.
    success();
    selection();
    expect(notificationMock).not.toHaveBeenCalled();
    expect(selectionMock).not.toHaveBeenCalled();

    // Через 200 мс окно открывается снова.
    vi.setSystemTime(new Date('2026-11-06T08:00:00.200'));
    tap();
    expect(impactMock).toHaveBeenCalledTimes(2);

    // 100 мс спустя — снова поглощено.
    vi.setSystemTime(new Date('2026-11-06T08:00:00.300'));
    tap();
    expect(impactMock).toHaveBeenCalledTimes(2);

    // Ещё через 100 мс (итого 200 от последнего) — проходит.
    vi.setSystemTime(new Date('2026-11-06T08:00:00.500'));
    warning();
    expect(notificationMock).toHaveBeenCalledTimes(1);
    expect(notificationMock).toHaveBeenCalledWith('warning');
  });

  it('ошибки expo-haptics (web/неподдержка) не роняют вызывавший код', async () => {
    impactMock.mockRejectedValueOnce(new Error('unavailable'));
    expect(() => tap()).not.toThrow();
    await Promise.resolve(); // микрозадача .catch отработала — неупавший вызов
  });
});
