/**
 * Флаги первого запуска (v0.6.2-C, ADR-029).
 *
 * Онбординг и coach marks показываются один раз. Хранение — то же, что у
 * настроек (preferences-storage, ADR-024): native — AsyncStorage (там
 * уже лежат токены и outbox), web — localStorage (демо-платформа).
 *
 * Ключи версионируются (v1): смена формата онбординга → ключ v2, и все
 * пользователи увидят обновлённые слайды один раз.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const isWeb = Platform.OS === 'web';

/** Значения флагов — строка 'seen', чтобы хранилище оставалось KV. */
const SEEN = 'seen';

/** Ключ онбординга. */
const ONBOARDING_KEY = 'agromoll.onboarding.v1';
/** Префикс coach mark'ов роли. */
const COACH_KEY_PREFIX = 'agromoll.coachmark.';

async function read(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return AsyncStorage.getItem(key);
}

async function write(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // приватный режим — подсказки покажутся ещё раз, не критично
    }
    return;
  }
  await AsyncStorage.setItem(key, value);
}

/** Онбординг уже показывали этому пользователю? */
export async function isOnboardingSeen(): Promise<boolean> {
  return (await read(ONBOARDING_KEY)) === SEEN;
}

/** Онбординг пройден (кнопка «Начать» или «Пропустить»). */
export async function markOnboardingSeen(): Promise<void> {
  await write(ONBOARDING_KEY, SEEN);
}

/** Coach mark роли уже показывали? */
export async function isCoachMarkSeen(role: string): Promise<boolean> {
  return (await read(COACH_KEY_PREFIX + role)) === SEEN;
}

/** Coach mark роли показан (тап или авто-скрытие). */
export async function markCoachMarkSeen(role: string): Promise<void> {
  await write(COACH_KEY_PREFIX + role, SEEN);
}
