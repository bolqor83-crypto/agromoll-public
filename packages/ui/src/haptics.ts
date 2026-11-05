/**
 * Тактильная карта приложения (v0.3.1, ADR-009).
 *
 * Единая точка доступа к haptics: три базовых сигнала + selection для
 * вкладок (B6). Назначение сигналов — не «сколько угодно вибраций»,
 * а словарь: рынок в 4 утра, каждое касание должно что-то значить.
 *
 *  - tap()      — лёгкий отклик: все кнопки и карточки (impact Light);
 *  - success()  — подтверждение результата: бронь создана, очередь
 *                 синхронизирована (notification Success);
 *  - warning()  — внимание без тревоги: конфликт outbox, истёкшая бронь
 *                 (notification Warning);
 *  - selection() — переключение вкладок (selection, B6).
 *
 * Антиспам: не более ОДНОГО сигнала за 150 мс — сетка быстрых нажатий
 * не превращается в жужжание. На web все вызовы — безопасные no-op
 * (expo-haptics сам игнорирует неподдерживаемые платформы, ошибки
 * гасим на всякий случай).
 */
import * as Haptics from 'expo-haptics';

/** Минимальный интервал между любыми сигналами, мс. */
const THROTTLE_MS = 150;

/** Момент последнего сработавшего сигнала (0 — ещё не было). */
let lastFiredAt = 0;

/** Пропускает сигнал, если с прошлого прошло меньше THROTTLE_MS. */
function shouldFire(): boolean {
  const now = Date.now();
  if (now - lastFiredAt < THROTTLE_MS) {
    return false;
  }
  lastFiredAt = now;
  return true;
}

/** Безопасный вызов expo-haptics: ошибки (web/неподдержка) не роняют UI. */
function safe(call: () => Promise<void>): void {
  call().catch(() => undefined);
}

/** Лёгкий отклик нажатия: кнопки, карточки. */
export function tap(): void {
  if (shouldFire()) {
    safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  }
}

/** Успешное завершение действия: бронь, синхронизация очереди. */
export function success(): void {
  if (shouldFire()) {
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  }
}

/** Внимание: конфликт, истечение TTL брони. Мягкий тон, не тревога. */
export function warning(): void {
  if (shouldFire()) {
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  }
}

/** Переключение вкладки (selection-отклик, B6). */
export function selection(): void {
  if (shouldFire()) {
    safe(() => Haptics.selectionAsync());
  }
}

/** Только для тестов: сброс троттлинга. */
export function __resetHapticsThrottle(): void {
  lastFiredAt = 0;
}
