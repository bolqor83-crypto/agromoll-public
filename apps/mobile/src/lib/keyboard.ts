/**
 * Клавиатура (v0.6.1-B, ADR-024).
 *
 * Поведение KeyboardAvoidingView по платформам:
 *  - iOS: 'padding' — контент сжимается на высоту клавиатуры;
 *  - Android: 'height' — система умеет adjustResize, но внутри Modal
 *    (модалки-листы) resize не срабатывает — 'height' страхует;
 *  - Web: undefined — физической клавиатуры-оверлея нет, KAV выключен.
 */
import { Platform } from 'react-native';
import type { KeyboardAvoidingViewProps } from 'react-native';

export type KeyboardBehavior = KeyboardAvoidingViewProps['behavior'];

/** Чистая функция — все платформенные сценарии покрыты юнит-тестами. */
export function resolveKeyboardBehavior(os: Platform['OS']): KeyboardBehavior {
  if (os === 'ios') {
    return 'padding';
  }
  if (os === 'android') {
    return 'height';
  }
  return undefined;
}

/** Behavior для текущей платформы (вычислен один раз при импорте). */
export const keyboardBehavior: KeyboardBehavior = resolveKeyboardBehavior(Platform.OS);
