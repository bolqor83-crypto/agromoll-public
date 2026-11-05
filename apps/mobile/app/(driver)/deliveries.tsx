import { EmptyState, Screen } from '@agromoll/ui';
import { ScreenHeader } from '@/components';

/** «Мои доставки» — заглушка этапа v0.2.0 (доставки на следующем этапе). */
export default function DeliveriesScreen() {
  return (
    <Screen>
      <ScreenHeader title="Мои доставки" subtitle="История и активные рейсы" />
      <EmptyState
        illustration="box"
        title="Доставок пока нет"
        description="Активные и завершённые рейсы появятся здесь на следующем этапе."
      />
    </Screen>
  );
}
