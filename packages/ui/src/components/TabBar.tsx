/**
 * TabBar — нижняя панель вкладок с pill-индикатором.
 *
 * Презентационный компонент дизайн-системы: сам навигацию не знает,
 * получает items/activeKey/onChange. Интеграция с expo-router Tabs —
 * через проп tabBar (см. apps/mobile), поэтому TabBar остаётся чистым
 * и переиспользуемым (ADR-005).
 *
 * Активная вкладка: мягкая зелёная «пилюля» позади, плавный spring-переход
 * (200–300 мс). Подпись есть у всех вкладок, активная — зелёная и жирная.
 */
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { motion, radius, spacing, touchTarget } from '../tokens';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface TabBarItem {
  key: string;
  label: string;
  icon: IconName;
}

export interface TabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onChange: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function TabBar({ items, activeKey, onChange, style }: TabBarProps) {
  const { colors } = useTheme();
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.key === activeKey),
  );

  // Лэйауты вкладок замеряем один раз — пилюля потом просто переезжает.
  const layouts = useRef<Record<number, { x: number; width: number }>>({});
  const pillLeft = useSharedValue(-999);
  const pillWidth = useSharedValue(0);

  useEffect(() => {
    const target = layouts.current[activeIndex];
    if (target) {
      pillLeft.value = withSpring(target.x, motion.pressSpring);
      pillWidth.value = withSpring(target.width, motion.pressSpring);
    }
  }, [activeIndex, pillLeft, pillWidth]);

  const handleLayout = (index: number) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    layouts.current[index] = { x, width };
    if (index === activeIndex && pillLeft.value < 0) {
      pillLeft.value = x;
      pillWidth.value = width;
    }
  };

  const pillStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    top: spacing.xs,
    left: pillLeft.value,
    width: pillWidth.value,
    height: touchTarget.min,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryMuted,
  }));

  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: 'row',
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.sm,
          paddingBottom: spacing.xs,
        },
        style,
      ]}
    >
      {/* Пилюля — общий слой позади вкладок */}
      <Animated.View pointerEvents="none" style={pillStyle} />
      {items.map((item, index) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.key)}
            onLayout={handleLayout(index)}
            style={{
              flex: 1,
              minHeight: touchTarget.min,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              paddingTop: spacing.xs,
            }}
          >
            <Icon name={item.icon} size={24} color={active ? 'primary' : 'muted'} />
            <Animated.Text
              style={{
                fontSize: 13,
                lineHeight: 16,
                fontWeight: '600',
                color: active ? colors.primary : colors.textMuted,
              }}
            >
              {item.label}
            </Animated.Text>
          </Pressable>
        );
      })}
    </View>
  );
}
