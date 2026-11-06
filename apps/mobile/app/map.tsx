/**
 * Экран «Карта рынка» (v0.5.0, ADR-014).
 *
 * v0.6.1-A: тонкая обёртка — код MarketMapScreen грузится отдельным
 * чанком (SVG-схема рынка не нужна в главном бандле, ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() =>
  import('@/components/MarketMapScreen').then((m) => ({ default: m.MarketMapScreen })),
);
