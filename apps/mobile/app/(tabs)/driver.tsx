import { View } from 'react-native';
import { Badge, Button, Card, Screen, spacing, Text } from '@agromoll/ui';
import { PhotoPlaceholder, ScreenHeader } from '@/components';
import { pressFeedback } from '@/lib/feedback';

/** Данные-заглушки: попутные маршруты доставщика. */
const ROUTES = [
  {
    id: 'r-1',
    icon: 'car-sport',
    title: 'Рынок → Батайск',
    details: 'Легковая · до 400 кг · 3 точки',
    pay: '600 ₽ · 14 км',
    badge: 'Срочно',
    badgeVariant: 'attention',
  },
  {
    id: 'r-2',
    icon: 'cube',
    title: 'Рынок → Таганрог',
    details: 'Газель · до 1,5 т · 1 точка',
    pay: '1 900 ₽ · 68 км',
    badge: 'Свободно',
    badgeVariant: 'success',
  },
] as const;

export default function DriverScreen() {
  return (
    <Screen>
      <ScreenHeader
        title="Доставщик"
        subtitle="Попутные маршруты на утро"
        badge={<Badge label="Смена открыта · 4:00–14:00" variant="success" />}
      />

      <View style={{ gap: spacing.lg }}>
        {ROUTES.map((route, index) => (
          <Card key={route.id} style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <PhotoPlaceholder icon={route.icon} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="title">{route.title}</Text>
                <Text variant="caption" color="secondary">
                  {route.details}
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
                    {route.pay}
                  </Text>
                  <Badge label={route.badge} variant={route.badgeVariant} />
                </View>
              </View>
            </View>
            {index === 0 ? (
              <Button
                title="Взять рейс"
                onPress={() => {
                  void pressFeedback('взятие рейса', { id: route.id, route: route.title });
                }}
              />
            ) : (
              <Button
                variant="secondary"
                title="Открыть"
                onPress={() => {
                  void pressFeedback('открытие маршрута', { id: route.id });
                }}
              />
            )}
          </Card>
        ))}

        <Card elevated style={{ gap: spacing.sm }}>
          <Text variant="title">Заявки появятся здесь</Text>
          <Text variant="caption" color="secondary">
            Когда продавцы соберут заказы, вы увидите попутные маршруты и заработок. Экран-заглушка
            этапа «фундамент».
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
