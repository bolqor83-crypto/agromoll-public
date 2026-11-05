/**
 * Screen — обёртка экрана: фон темы, safe-area (вырезы/жесты), скролл.
 * Все экраны приложения начинаются с <Screen>.
 */
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { spacing } from '../tokens';

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
}

export function Screen({
  children,
  scroll = true,
  edges,
  padding = spacing.lg,
  backgroundColor,
  contentContainerStyle,
}: ScreenProps) {
  const { colors } = useTheme();
  const bg = backgroundColor ?? colors.background;

  return (
    <SafeAreaView
      edges={edges ?? ['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: bg }}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={[{ padding, paddingBottom: spacing.xxl }, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding }, contentContainerStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
