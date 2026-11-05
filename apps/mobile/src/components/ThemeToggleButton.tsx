import { Pressable } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Text, useTheme } from '@agromoll/ui';

import { hapticImpact } from '../lib/haptics';
import { logger } from '../lib/logger';
import { useSettingsStore } from '../store/settings';

/**
 * Переключатель светлой/тёмной темы в шапке. Зона нажатия 48×48.
 * По умолчанию приложение следует системе; кнопка задаёт режим явно.
 */
export function ThemeToggleButton() {
  const { colors, radius, mode } = useTheme();
  const setThemeMode = useSettingsStore((state) => state.setThemeMode);

  const handlePress = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    void hapticImpact();
    logger.info('Тема переключена', { next });
  };

  const buttonStyle: ViewStyle = {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <Pressable
      testID="theme-toggle"
      accessibilityRole="button"
      accessibilityLabel={mode === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      hitSlop={8}
      onPress={handlePress}
      style={buttonStyle}
    >
      <Text variant="title" align="center">
        {mode === 'dark' ? '☀️' : '🌙'}
      </Text>
    </Pressable>
  );
}
