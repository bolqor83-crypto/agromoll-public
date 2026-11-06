/**
 * «Витрина» продавца (v0.6.1-A): тонкая обёртка — код экрана в
 * src/screens/ShowcaseScreen, отдельный чанк (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/ShowcaseScreen'));
