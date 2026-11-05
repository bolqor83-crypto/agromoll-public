import { Platform } from 'react-native';

/**
 * Тактильная отдача на ключевых действиях (переходы, бронь, подтверждение).
 * На web отключена; ошибки проглатываем — haptics не должен ломать UX.
 */
export async function hapticImpact(style: 'light' | 'medium' = 'light'): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.impactAsync(
      style === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {
    // Устройство без вибромотора или haptics недоступен — тихо игнорируем.
  }
}
