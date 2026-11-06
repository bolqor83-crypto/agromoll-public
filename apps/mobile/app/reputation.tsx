/**
 * Мой рейтинг (v0.6.1-A): тонкая обёртка — код экрана в
 * src/screens/ReputationScreen, отдельный чанк (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/ReputationScreen'), 'plain');
