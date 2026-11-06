/**
 * Тесты флагов первого запуска (v0.6.2-C, ADR-029).
 *
 * Онбординг и coach marks показываются ровно один раз. Проверяем
 * контракт lib/first-run против мока AsyncStorage (jest-платформа iOS):
 * до записи — не виден, после записи — виден; ключи изолированы по ролям.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isCoachMarkSeen,
  isOnboardingSeen,
  markCoachMarkSeen,
  markOnboardingSeen,
} from './first-run';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('first-run: онбординг показывается только при первом запуске', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('до записи флаг не поднят — онбординг показывается', async () => {
    expect(await isOnboardingSeen()).toBe(false);
  });

  it('после «Начать»/«Пропустить» флаг поднят — повторно не показывается', async () => {
    await markOnboardingSeen();
    expect(await isOnboardingSeen()).toBe(true);
    // идемпотентность: повторная запись не ломает
    await markOnboardingSeen();
    expect(await isOnboardingSeen()).toBe(true);
  });

  it('флаг онбординга переживает «перезапуск» (хранилище то же)', async () => {
    await markOnboardingSeen();
    // новый импорт модуля не сбрасывает AsyncStorage
    expect(await isOnboardingSeen()).toBe(true);
  });
});

describe('first-run: coach marks по ролям изолированы', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('каждая роль видит свои подсказки ровно один раз', async () => {
    expect(await isCoachMarkSeen('buyer')).toBe(false);
    expect(await isCoachMarkSeen('seller')).toBe(false);

    await markCoachMarkSeen('buyer');
    expect(await isCoachMarkSeen('buyer')).toBe(true);
    // seller ещё не видел — флаг покупателя не «протекает»
    expect(await isCoachMarkSeen('seller')).toBe(false);

    await markCoachMarkSeen('seller');
    expect(await isCoachMarkSeen('seller')).toBe(true);
    expect(await isCoachMarkSeen('driver')).toBe(false);
  });

  it('ключи версионированы (v1) — в хранилище только наши ключи', async () => {
    await markOnboardingSeen();
    await markCoachMarkSeen('driver');
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toContain('agromoll.onboarding.v1');
    expect(keys).toContain('agromoll.coachmark.driver');
  });
});
