/**
 * «Часы 289-ФЗ» продавца: общий экран с водителем (v0.4.0).
 *
 * v0.6.1-A: WorkHoursScreen грузится отдельным чанком (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() =>
  import('@/components/WorkHoursScreen').then((m) => ({ default: m.WorkHoursScreen })),
);
