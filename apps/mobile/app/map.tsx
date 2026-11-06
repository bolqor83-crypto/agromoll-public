/**
 * Экран «Карта рынка» (v0.5.0, подэтап B, ADR-014).
 *
 * Тонкая обёртка над MarketMapScreen: экраны приложения живут в
 * src/components (как DebtsScreen и WorkHoursScreen), файлы в app/ —
 * только маршруты Expo Router.
 */
import { MarketMapScreen } from '@/components';

export default function MapRoute() {
  return <MarketMapScreen />;
}
