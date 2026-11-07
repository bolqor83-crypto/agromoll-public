/**
 * Споры (v0.6.0-C): тонкая обёртка — код экрана в src/screens/
 * DisputesScreen, отдельный чанк (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/DisputesScreen'), 'cards');
