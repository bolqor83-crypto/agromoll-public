import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Screen, Text, useTheme } from '@agromoll/ui';

import { ThemeToggleButton } from '../src/components/ThemeToggleButton';
import { ROLE_OPTIONS, STUB_NOTE } from '../src/data/placeholders';
import { hapticImpact } from '../src/lib/haptics';
import { logger } from '../src/lib/logger';

/**
 * Точка входа: выбор роли. Три крупные карточки — покупатель, продавец, доставщик.
 * Одно очевидное действие на экране.
 */
export default function RolePickerScreen() {
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();

  const handleSelect = (href: string, title: string) => {
    void hapticImpact();
    logger.info('Выбрана роль', { role: title });
    router.push(href as never);
  };

  return (
    <Screen headerRight={<ThemeToggleButton />}>
      <Text variant="caption" color="muted" style={styles.brand}>
        АгроМолл · рынок Ростов-на-Дону
      </Text>
      <Text variant="display" style={styles.title}>
        Кто вы сегодня?
      </Text>
      <Text variant="body" color="secondary" style={styles.subtitle}>
        Выберите роль — покажем только то, что нужно вам.
      </Text>

      <View style={styles.list}>
        {ROLE_OPTIONS.map((option) => (
          <Card key={option.role} onPress={() => handleSelect(option.href, option.title)}>
            <View style={styles.roleRow}>
              <View
                style={[
                  styles.roleEmoji,
                  {
                    backgroundColor: colors.primaryMuted,
                    borderRadius: radius.md,
                    marginRight: spacing.md,
                  },
                ]}
              >
                <Text variant="title" align="center">
                  {option.emoji}
                </Text>
              </View>
              <View style={styles.roleInfo}>
                <Text variant="title">{option.title}</Text>
                <Text variant="caption" color="secondary">
                  {option.caption}
                </Text>
              </View>
              <Text variant="title" color="primary" style={styles.chevron}>
                ›
              </Text>
            </View>
          </Card>
        ))}
      </View>

      <Text variant="caption" color="muted" style={styles.note}>
        {STUB_NOTE}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  title: { marginBottom: 8 },
  subtitle: { marginBottom: 24 },
  list: { gap: 12 },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  roleEmoji: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleInfo: { flex: 1, gap: 2 },
  chevron: { marginLeft: 4 },
  note: { textAlign: 'center', marginTop: 24 },
});
