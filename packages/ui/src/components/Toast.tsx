/**
 * Toast — всплывающее in-app уведомление (v0.6.0-A, ADR-031).
 *
 * Стиль — дизайн-система v0.6.2: повышенная поверхность surfaceElevated,
 * скругление radius.md (16), тень двумя слоями (светлая тема, web) /
 * усиленная рамка (тёмная), типографика Inter. Появление — выезд сверху
 * + fade (motion.normal, ADR-027), автоскрытие через 4 с, reduced
 * motion — только fade, без движения.
 *
 * Тап — переход к объекту уведомления (deep link): push — сигнал,
 * не источник данных (ADR-031).
 */
import { useEffect } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { font, motion, radius, shadow, spacing } from '../tokens';
import { Icon } from './Icon';

/** Автоскрытие: достаточно прочитать заголовок, не мешает работе. */
const AUTO_HIDE_MS = 4000;

export interface ToastProps {
  title: string;
  body?: string;
  /** Тап по тосту — переход к объекту (booking/delivery/debt…). */
  onPress?: () => void;
  /** Явное скрытие родителем (например, очередь тостов). */
  onDismiss?: () => void;
  /** Переопределить автоскрытие (0 — не скрывать автоматически). */
  autoHideMs?: number;
  testID?: string;
}

export function Toast({
  title,
  body,
  onPress,
  onDismiss,
  autoHideMs = AUTO_HIDE_MS,
  testID = 'toast',
}: ToastProps) {
  const { colors, mode } = useTheme();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (autoHideMs <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => onDismiss?.(), autoHideMs);
    return () => clearTimeout(timer);
  }, [autoHideMs, onDismiss]);

  // Тёмная тема: тени не видны — глубина через усиленную рамку (ADR-030);
  // светлая — мягкая тень, на web многослойная (2 слоя, ADR-028).
  const isDark = mode === 'dark';
  const surfaceStyle: ViewStyle = {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    ...(isDark
      ? { borderWidth: 1, borderColor: colors.borderStrong }
      : {
          ...shadow.light,
          ...(Platform.OS === 'web' ? { boxShadow: shadow.light.boxShadowWeb } : null),
        }),
  };

  const content = (
    <View
      style={[
        surfaceStyle,
        { padding: spacing.md, gap: spacing.sm, flexDirection: 'row', alignItems: 'flex-start' },
      ]}
    >
      <Icon name="notifications-outline" size={20} color="primary" />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Animated.Text
          accessibilityRole="header"
          style={{
            fontFamily: font.semibold,
            fontSize: 15,
            lineHeight: 20,
            color: colors.text,
          }}
        >
          {title}
        </Animated.Text>
        {body ? (
          <Animated.Text
            style={{
              fontFamily: font.regular,
              fontSize: 13,
              lineHeight: 18,
              color: colors.textSecondary,
            }}
          >
            {body}
          </Animated.Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Animated.View
      testID={testID}
      entering={
        reducedMotion ? FadeIn.duration(motion.normal) : SlideInDown.duration(motion.normal)
      }
      exiting={FadeOut.duration(motion.fast)}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Уведомление: ${title}`}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Открыть: ${title}`}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
    </Animated.View>
  );
}
