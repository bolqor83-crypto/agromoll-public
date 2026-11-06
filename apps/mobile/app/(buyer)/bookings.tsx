/**
 * «Мои брони» покупателя (v0.6.1-A): тонкая обёртка — код экрана в
 * src/screens/BookingsScreen, отдельный чанк (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/BookingsScreen'));
