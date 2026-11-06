/**
 * «Долги» покупателя: «Должны мне» / «Я должен» в одной вкладке (v0.4.0).
 * Экран общий с продавцом — разница лишь в данных текущего пользователя.
 *
 * v0.6.1-A: DebtsScreen грузится отдельным чанком (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() =>
  import('@/components/DebtsScreen').then((m) => ({ default: m.DebtsScreen })),
);
