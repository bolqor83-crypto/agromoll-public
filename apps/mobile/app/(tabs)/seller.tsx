import { View } from 'react-native';
import { Badge, Button, Card, Screen, spacing, Text } from '@agromoll/ui';
import { PhotoPlaceholder, ScreenHeader } from '@/components';
import { pressFeedback } from '@/lib/feedback';

/** Данные-заглушки: заказы, которые продавец видит ранним утром. */
const ORDERS = [
  {
    id: 'o-1042',
    icon: 'receipt',
    title: 'Заказ №1042 · ларёк «У Гагика»',
    items: 'Помидоры — 20 кг · Лук — 15 кг',
    total: '2 480 ₽',
    badge: 'Новый',
    badgeVariant: 'attention',
  },
  {
    id: 'o-1041',
    icon: 'receipt',
    title: 'Заказ №1041 · кафе «Восход»',
    items: 'Сметана — 30 кг · Зелень — 5 кг',
    total: '3 900 ₽',
    badge: 'Подтверждён',
    badgeVariant: 'success',
  },
  {
    id: 'o-1039',
    icon: 'archive',
    title: 'Заказ №1039 · пекарня «Колос»',
    items: 'Мука — 50 кг',
    total: '1 750 ₽',
    badge: 'Отгружен',
    badgeVariant: 'neutral',
  },
] as const;

export default function SellerScreen() {
  return (
    <Screen>
      <ScreenHeader
        title="Продавец"
        subtitle="Ваши заказы на сегодня"
        badge={<Badge label="2 новых заказа" variant="attention" />}
      />

      <View style={{ gap: spacing.lg }}>
        {ORDERS.map((order, index) => (
          <Card key={order.id} style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <PhotoPlaceholder icon={order.icon} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="title">{order.title}</Text>
                <Text variant="caption" color="secondary">
                  {order.items}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: spacing.xs,
                  }}
                >
                  <Text variant="body" weight="700" color="primary">
                    {order.total}
                  </Text>
                  <Badge label={order.badge} variant={order.badgeVariant} />
                </View>
              </View>
            </View>
            {index === 0 ? (
              <Button
                title="Принять заказ"
                onPress={() => {
                  void pressFeedback('приём заказа', { id: order.id });
                }}
              />
            ) : (
              <Button
                variant="secondary"
                title="Открыть"
                onPress={() => {
                  void pressFeedback('открытие заказа', { id: order.id });
                }}
              />
            )}
          </Card>
        ))}

        <Text variant="caption" color="muted" align="center">
          Экран-заглушка: управление заказами появится на следующем этапе.
        </Text>
      </View>
    </Screen>
  );
}
