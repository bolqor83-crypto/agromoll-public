import { EmptyState, Screen } from '@agromoll/ui';
import { ScreenHeader } from '@/components';

/**
 * Радар доставщика: очередь попутных заказов появится на следующем этапе.
 * Пустое состояние — честное и спокойное (ADR-002): без «скоро-скоро» тревоги.
 */
export default function RadarScreen() {
  return (
    <Screen>
      <ScreenHeader title="Радар" subtitle="Попутные заказы по вашему маршруту" />
      <EmptyState
        illustration="radar"
        title="Скоро здесь появятся попутные заказы"
        description="Мы подключим очередь доставок, когда брони начнут подтверждаться. Пока готовьте Газель — утро близко."
      />
    </Screen>
  );
}
