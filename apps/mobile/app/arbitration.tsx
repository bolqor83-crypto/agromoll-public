/**
 * Арбитраж (v0.6.0-C): тонкая обёртка — код экрана в src/screens/
 * ArbitrationScreen, отдельный чанк (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/ArbitrationScreen'), 'cards');
