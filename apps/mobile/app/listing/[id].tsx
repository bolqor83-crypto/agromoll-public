/**
 * Карточка лота (v0.6.1-A): тонкая обёртка — код экрана в
 * src/screens/ListingDetailScreen, отдельный чанк; фолбэк 'plain'
 * (одна большая карточка, не список) — ADR-023.
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/ListingDetailScreen'), 'plain');
