/**
 * «Лента» покупателя (v0.6.1-A): тонкая обёртка — код экрана живёт в
 * src/screens/FeedScreen и грузится динамическим import() отдельным
 * чанком. Фолбэк — Skeleton-карточки (ADR-023).
 */
import { lazyScreen } from '@/lib/lazy-screen';

export default lazyScreen(() => import('@/screens/FeedScreen'));
