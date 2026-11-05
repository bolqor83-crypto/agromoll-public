/**
 * TabBar — нижняя панель вкладок с pill-индикатором (v0.3.1 — полировка).
 *
 * Презентационный компонент дизайн-системы: сам навигацию не знает,
 * получает items/activeKey/onChange. Интеграция с expo-router Tabs —
 * через проп tabBar (см. apps/mobile), поэтому TabBar остаётся чистым
 * и переиспользуемым (ADR-005).
 *
 * Активная вкладка: мягкая зелёная «пилюля» позади, плавный spring-переезд
 * (200–300 мс). v0.3.1:
 *  - иконка переключается cross-fade'ом (два слоя, прозрачности навстречу)
 *    с лёгким «подпрыгом» scale 1 → 1.1 → 1 за 200 мс;
 *  - тактильный selection-отклик при переключении (haptics-карта, ADR-009);
 *  - подложка — blur (expo-blur) на native, «прозрачная» сквозь контент
 *    при скролле; на web blur недоступен — solid surface (fallback).
 */
import { useEffect, useRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { motion, radius, spacing, touchTarget } from '../tokens';
import { selection } from '../haptics';
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

/** Подпрыг иконки при активации: 1 → 1.1 → 1 за ~200 мс. */
const ICON_BOUNCE_SPRING = { damping: 12, mass: 0.5, stiffness: 320 };
/** Длительность cross-fade иконок. */
const ICON_FADE_MS = 200;

export function TabBar({ items, activeKey, onChange, style }: TabBarProps) {
  const { colors, mode } = useTheme();
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

  const isWeb = Platform.OS === 'web';

  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.sm,
          paddingBottom: spacing.xs,
          // web (и platforms без blur): solid-подложка, как раньше
          backgroundColor: isWeb ? colors.surface : 'transparent',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* native: контент «просвечивает» сквозь панель при скролле */}
      {!isWeb ? (
        <BlurView
          intensity={40}
          tint={mode === 'dark' ? 'dark' : 'light'}
          style={{
            ...absoluteFill,
            backgroundColor: colors.surface + 'B3', // 70% surface поверх blur
          }}
        />
      ) : null}
      {/* Пилюля — общий слой позади вкладок */}
      <Animated.View pointerEvents="none" style={pillStyle} />
      {items.map((item, index) => (
        <TabBarItemButton
          key={item.key}
          item={item}
          active={item.key === activeKey}
          activeColor={colors.primary}
          inactiveColor={colors.textMuted}
          onLayout={handleLayout(index)}
          onPress={() => {
            selection();
            onChange(item.key);
          }}
        />
      ))}
    </View>
  );
}

const absoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

interface TabBarItemButtonProps {
  item: TabBarItem;
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  onLayout: (event: LayoutChangeEvent) => void;
  onPress: () => void;
}

/** Вкладка: иконка с cross-fade + bounce, подпись. */
function TabBarItemButton({
  item,
  active,
  activeColor,
  inactiveColor,
  onLayout,
  onPress,
}: TabBarItemButtonProps) {
  const scale = useSharedValue(1);
  const activeOpacity = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeOpacity.value = withTiming(active ? 1 : 0, { duration: ICON_FADE_MS });
    if (active) {
      // Подпрыг: небольшое увеличение и возврат spring'ом (~200 мс).
      scale.value = withSequence(
        withSpring(1.1, ICON_BOUNCE_SPRING),
        withSpring(1, ICON_BOUNCE_SPRING),
      );
    }
  }, [active, activeOpacity, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const activeLayerStyle = useAnimatedStyle(() => ({ opacity: activeOpacity.value }));
  const inactiveLayerStyle = useAnimatedStyle(() => ({ opacity: 1 - activeOpacity.value }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onLayout={onLayout}
      style={{
        flex: 1,
        minHeight: touchTarget.min,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingTop: spacing.xs,
      }}
    >
      {/* Два слоя иконки: неактивный гаснет, активный проявляется */}
      <Animated.View style={iconStyle}>
        <View style={{ width: 24, height: 24 }}>
          <Animated.View style={[absoluteFill, inactiveLayerStyle]}>
            <Icon name={item.icon} size={24} color="muted" />
          </Animated.View>
          <Animated.View style={[absoluteFill, activeLayerStyle]}>
            <Icon name={item.icon} size={24} color="primary" />
          </Animated.View>
        </View>
      </Animated.View>
      <Animated.Text
        style={{
          fontSize: 13,
          lineHeight: 16,
          fontWeight: '600',
          color: active ? activeColor : inactiveColor,
        }}
      >
        {item.label}
      </Animated.Text>
    </Pressable>
  );
}
