/**
 * DemoBanner — честный баннер демо-режима (v0.6.1-D, ADR-026).
 *
 * Когда API недоступен, лента и витрина показывают демо-данные — но не
 * «тихо», а с полноширинным янтарным баннером: «Демо-режим. API недоступен.
 * Данные не настоящие». Кнопки, которым нужен сервер, отключаются.
 *
 * Это временная мера для MVP (ADR-026): демо-фолбэк помогает показать
 * продукт без сервера, но не должен притворяться продакшеном.
 */
import { View } from 'react-native';
import { Icon, radius, spacing, Text, useTheme } from '@agromoll/ui';

/** Прозрачность янтарной подложки (~18%, как у attention-бейджа). */
const WARNING_BG_ALPHA = '2E';

export interface DemoBannerProps {
  /** Подсказка про отключённые кнопки конкретного экрана. */
  hint?: string;
  testID?: string;
}

export function DemoBanner({ hint, testID = 'demo-banner' }: DemoBannerProps) {
  const { colors } = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel="Демо-режим: API недоступен, данные не настоящие"
      style={{
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.warning + WARNING_BG_ALPHA,
        marginHorizontal: spacing.lg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Icon name="eye-outline" size={18} color="onWarning" />
        <Text variant="caption" weight="600" color="onWarning">
          Демо-режим
        </Text>
      </View>
      <Text variant="caption" color="onWarning">
        API недоступен. Данные не настоящие.{' '}
        {hint ?? 'Кнопки, которым нужен сервер, отключены.'}
      </Text>
    </View>
  );
}
