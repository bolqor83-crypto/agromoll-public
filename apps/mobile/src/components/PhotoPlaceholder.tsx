import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, useTheme } from '@agromoll/ui';

/**
 * Плейсхолдер фотографии: пока нет реальных фото товаров,
 * показываем мягкую зелёную плашку с иконкой (типографика: фото → название → цена → бейдж).
 */
export function PhotoPlaceholder({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: radius.md,
        backgroundColor: colors.primaryMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={26} color={colors.primary} />
    </View>
  );
}
