import { DebtsScreen } from '@/components/DebtsScreen';

/**
 * «Долги» продавца: «Должны мне» / «Я должен» в одной вкладке (v0.4.0).
 * Экран общий с покупателем — разница лишь в данных текущего пользователя.
 */
export default function SellerDebtsRoute() {
  return <DebtsScreen />;
}
