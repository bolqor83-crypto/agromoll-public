/**
 * «Долги» продавца: общий экран с покупателем (v0.4.0).
 *
 * v0.6.1-A: DebtsScreen грузится отдельным чанком (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() =>
  import('@/components/DebtsScreen').then((m) => ({ default: m.DebtsScreen })),
);
