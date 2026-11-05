import { View } from 'react-native';
import { Badge, Button, Card, Input, Screen, spacing, Text } from '@agromoll/ui';
import { PhotoPlaceholder, ScreenHeader } from '@/components';
import { pressFeedback } from '@/lib/feedback';

/** Данные-заглушки: демонстрируют, как дизайн-система собирается в карточку товара. */
const PRODUCTS = [
  {
    id: 'p-1',
    icon: 'leaf',
    name: 'Помидоры розовые',
    seller: 'ФХ «Донская долина» · ряд 12',
    price: '85 ₽/кг',
    badge: 'Свежий урожай',
    badgeVariant: 'success',
  },
  {
    id: 'p-2',
    icon: 'cube',
    name: 'Лук репчатый',
    seller: 'ИП Ковалёв · ряд 4',
    price: '32 ₽/кг',
    badge: 'Опт от 10 кг',
    badgeVariant: 'neutral',
  },
  {
    id: 'p-3',
    icon: 'nutrition',
    name: 'Картофель молодой',
    seller: 'КФХ «Заря» · ряд 8',
    price: '41 ₽/кг',
    badge: 'Осталось мало',
    badgeVariant: 'attention',
  },
] as const;

export default function BuyerScreen() {
  return (
    <Screen>
      <ScreenHeader
        title="Покупатель"
        subtitle="Рынок «Агро Молл» · утренний опт"
        badge={<Badge label="Рынок открыт · до 14:00" variant="success" />}
      />

      <Input placeholder="Найти товар или продавца" />

      <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
        {PRODUCTS.map((product) => (
          <Card key={product.id} style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <PhotoPlaceholder icon={product.icon} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="title">{product.name}</Text>
                <Text variant="caption" color="secondary">
                  {product.seller}
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
                    {product.price}
                  </Text>
                  <Badge label={product.badge} variant={product.badgeVariant} />
                </View>
              </View>
            </View>
            <Button
              title="Забронировать"
              onPress={() => {
                void pressFeedback('бронирование товара', { id: product.id, name: product.name });
              }}
            />
          </Card>
        ))}

        <Text variant="caption" color="muted" align="center">
          Экран-заглушка: бронирование появится на следующем этапе.
        </Text>
      </View>
    </Screen>
  );
}
