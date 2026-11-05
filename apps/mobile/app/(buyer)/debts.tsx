import { DebtsScreen } from '@/components/DebtsScreen';

/**
 * «Долги» покупателя: «Должны мне» / «Я должен» в одной вкладке (v0.4.0).
 * Экран общий с продавцом — разница лишь в данных текущего пользователя.
 */
export default function BuyerDebtsRoute() {
  return <DebtsScreen />;
}
