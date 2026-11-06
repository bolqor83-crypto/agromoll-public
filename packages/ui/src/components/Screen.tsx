/**
 * Screen — обёртка экрана: фон темы, safe-area (вырезы/жесты), скролл.
 * Все экраны приложения начинаются с <Screen>.
 *
 * v0.6.2-D (ADR-030): на широких экранах (≥430) контентная колонка
 * ограничена 600 px и центрирована — строки не растягиваются в 60+
 * символов на iPhone Pro Max, приложение на планшете выглядит
 * «как нативное», а не «растянутое» (аудит №16). Фон экрана при этом
 * заливается на всю ширину — колонка не выглядит «вклеенной».
 */
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { responsive, spacing } from '../tokens';
import { useResponsive } from '../hooks/useResponsive';

export interface ScreenProps {
  children: ReactNode;
  /** По умолчанию экран скроллится — контента немного, но на маленьких экранах безопаснее. */
  scroll?: boolean;
  /** Какие края учитывать в safe-area. По умолчанию все. */
  edges?: Edge[];
  padding?: number;
  backgroundColor?: string;
  /** Дополнительные стили контейнера контента. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Ограничение контентной колонки (v0.6.2-D): число — своя ширина,
   * false — полноширинный экран (например, карта на весь экран).
   * По умолчанию — 600 px на экранах шире 430, на телефонах — без ограничения.
   */
  maxContentWidth?: number | false;
}

export function Screen({
  children,
  scroll = true,
  edges,
  padding = spacing.lg,
  backgroundColor,
  contentContainerStyle,
  maxContentWidth,
}: ScreenProps) {
  const { colors } = useTheme();
  const { isWidePhone } = useResponsive();
  const bg = backgroundColor ?? colors.background;

  const cap =
    maxContentWidth === false
      ? null
      : (maxContentWidth ?? (isWidePhone ? responsive.contentMaxWidth : null));
  const capStyle: StyleProp<ViewStyle> = cap
    ? { maxWidth: cap, width: '100%', alignSelf: 'center' }
    : null;

  return (
    <SafeAreaView
      edges={edges ?? ['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: bg }}
    >
      {scroll ? (
        <ScrollView
          style={[{ flex: 1 }, capStyle]}
          contentContainerStyle={[{ padding, paddingBottom: spacing.xxl }, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding }, capStyle, contentContainerStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
