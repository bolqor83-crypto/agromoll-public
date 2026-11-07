/**
 * Детали апелляции 289-ФЗ (v0.7.0-C, ADR-037): тонкая обёртка — код
 * экрана в src/screens/AppealDetailScreen, отдельный чанк (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/AppealDetailScreen'), 'plain');
