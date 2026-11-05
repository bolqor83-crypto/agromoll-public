import * as Haptics from 'expo-haptics';
import { logger } from './logger';

/**
 * Тактильная отдача ключевых действий (бронь, подтверждение, взятие рейса).
 * По ADR-002: нажатие должно «чувствоваться» — в перчатках и спешке это важнее
 * визуального отклика. На web-экспорте вызов безопасно игнорируется.
 */
export async function pressFeedback(action: string, data?: Record<string, unknown>): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // web / не поддерживается — молча пропускаем
  }
  logger.info('action', `действие «${action}» (заглушка этапа «фундамент»)`, data);
}
