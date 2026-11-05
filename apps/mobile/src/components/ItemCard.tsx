import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text, useTheme } from '@agromoll/ui';

import type { PlaceholderCard } from '../data/placeholders';

interface ItemCardProps {
  item: PlaceholderCard;
  onPress?: () => void;
}

/**
 * Карточка-строка списка: эмодзи-«фото», название, подпись и бейдж.
 * Минимум текста — всё читается за долю секунды в спешке.
 */
export function ItemCard({ item, onPress }: ItemCardProps) {
  const { colors, radius, spacing } = useTheme();

  return (
    <Card onPress={onPress}>
      <View style={styles.row}>
        <View
          style={[
            styles.emojiCircle,
            {
              backgroundColor: colors.primaryMuted,
              borderRadius: radius.sm,
              marginRight: spacing.md,
            },
          ]}
        >
          <Text variant="title" align="center">
            {item.emoji}
          </Text>
        </View>

        <View style={styles.info}>
          <Text variant="body" style={{ fontWeight: '600', color: colors.text }}>
            {item.title}
          </Text>
          <Text variant="caption" color="secondary">
            {item.caption}
          </Text>
        </View>

        <View style={styles.badgeWrap}>
          <Badge label={item.badge.label} variant={item.badge.variant} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  emojiCircle: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  badgeWrap: {
    marginLeft: 12,
    flexShrink: 0,
  },
});
