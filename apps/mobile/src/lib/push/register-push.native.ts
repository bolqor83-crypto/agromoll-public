/**
 * Регистрация push-канала (v0.6.0-A, ADR-031) — native (iOS/Android).
 *
 * expo-notifications: разрешение → Expo Push Token (под капотом
 * FCM/APNs) → POST /notifications/register { platform, token }.
 * Сервер шлёт по FCM HTTP v1 (ADR-031). API совпадает с web-версией
 * (register-push.ts) — потребитель не знает о платформе.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PushPermission, RegisterPushDeps, RegisterPushResult } from './push-shared';

/** Поддержка push на платформе (native — да, SDK в бандле). */
export function isPushSupported(): boolean {
  return true;
}

/** Текущее разрешение (маппинг expo-notifications → Web-семантика). */
export async function getPushPermission(): Promise<PushPermission> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) {
    return 'granted';
  }
  return settings.canAskAgain === false ? 'denied' : 'default';
}

/**
 * Зарегистрировать нативный push. Тихие отказы (эмулятор без Google
 * Services, симулятор iOS) — норма dev-окружения (ADR-031).
 */
export async function registerPush(options: RegisterPushDeps): Promise<RegisterPushResult> {
  let settings = await Notifications.getPermissionsAsync();
  if (!settings.granted && settings.canAskAgain) {
    settings = await Notifications.requestPermissionsAsync();
  }
  if (!settings.granted) {
    return { registered: false, permissionGranted: false, reason: 'no_permission' };
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) {
      return { registered: false, permissionGranted: true, reason: 'error' };
    }
    await options.subscribe({
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      token,
    });
    return { registered: true, permissionGranted: true };
  } catch {
    // Эмулятор/симулятор без push-инфраструктуры — тихо (ADR-031).
    return { registered: false, permissionGranted: true, reason: 'error' };
  }
}
