import { Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, useTheme } from '@agromoll/ui';
import { useThemeStore } from '@/store/theme';

/** Кнопка переключения светлая/тёмная тема. Зона нажатия — 48×48. */
export function ThemeToggle() {
  const { colors, mode } = useTheme();
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <Pressable
      testID="theme-toggle"
      accessibilityLabel="Переключить тему"
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => toggle(mode)}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
        size={22}
        color={colors.text}
      />
    </Pressable>
  );
}
