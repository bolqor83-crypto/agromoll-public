/**
 * Badge — мягкий бейдж-«пилюля»: зелёный (успех), янтарный (срочность),
 * нейтральный. Без резких цветов: срочность не должна тревожить в 4 утра.
 */
import { View } from 'react-native';
import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { Text } from './Text';

export interface BadgeProps {
  label: string;
  /** success — зелёный, attention — мягкий янтарный, neutral — серо-тёплый. */
  variant?: 'success' | 'attention' | 'neutral';
}

/** Прозрачность заливки янтарного бейджа (~18%), чтобы он оставался мягким. */
const ATTENTION_BG_ALPHA = '2E';

export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  const { colors } = useTheme();

  const bg =
    variant === 'success'
      ? colors.primaryMuted
      : variant === 'attention'
        ? colors.warning + ATTENTION_BG_ALPHA
        : colors.background;

  const fg: 'primary' | 'onWarning' | 'secondary' =
    variant === 'success' ? 'primary' : variant === 'attention' ? 'onWarning' : 'secondary';

  return (
    <View
      accessibilityLabel={label}
      style={{
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: 3,
        backgroundColor: bg,
        borderWidth: variant === 'neutral' ? 1 : 0,
        borderColor: colors.border,
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="caption" color={fg} weight="600">
        {label}
      </Text>
    </View>
  );
}
