import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../tokens';
import { Text } from './Text';

export interface ScreenProps {
  children: React.ReactNode;
  /** Заголовок в шапке (крупный заголовок контента экраны рисуют сами). */
  title?: string;
  /** Кнопка «назад» (48×48) — появляется, если передан обработчик. */
  onBack?: () => void;
  /** Правый слот шапки (например, переключатель темы). */
  headerRight?: React.ReactNode;
  /** Прокручиваемый контент. По умолчанию true. */
  scroll?: boolean;
  /** Внутренние отступы. По умолчанию true. */
  padded?: boolean;
  /** Какие края учитывать в safe-area. По умолчанию только верх. */
  edges?: ReadonlyArray<Edge>;
  testID?: string;
}

/**
 * Обёртка экрана: тёплый фон темы, safe-area, простая шапка и прокрутка.
 * Один экран — одно очевидное действие.
 */
export function Screen({
  children,
  title,
  onBack,
  headerRight,
  scroll = true,
  padded = true,
  edges = ['top'],
  testID,
}: ScreenProps) {
  const { colors } = useTheme();

  const hasHeader = Boolean(onBack || headerRight || title);

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padded && styles.padded]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded]}>{children}</View>
  );

  return (
    <SafeAreaView testID={testID} edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      {hasHeader ? (
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Назад"
                hitSlop={spacing.sm}
                onPress={onBack}
                style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text variant="title" color="primary" style={styles.backGlyph}>
                  ‹
                </Text>
              </Pressable>
            ) : null}
          </View>

          {title ? (
            <Text variant="title" style={styles.headerTitle}>
              {title}
            </Text>
          ) : (
            <View style={styles.headerSpacer} />
          )}

          <View style={[styles.headerSide, styles.headerSideRight]}>{headerRight ?? null}</View>
        </View>
      ) : null}

      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  headerSide: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
  },
  content: {
    paddingBottom: spacing.xxl + spacing.xl,
  },
  padded: {
    paddingHorizontal: spacing.lg,
  },
});
