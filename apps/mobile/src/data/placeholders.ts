import type { BadgeVariant } from '@agromoll/ui';
import type { Role } from '@agromoll/types';

/**
 * Плейсхолдерные данные для экранов-заглушек.
 * Язык рынка, без софта: «опт от 50 кг», «до 6:00», «предоплата».
 * Никакой бизнес-логики — только демонстрация дизайн-системы.
 */

export interface RoleOption {
  role: Role;
  emoji: string;
  title: string;
  caption: string;
  href: `/buyer` | `/seller` | `/driver`;
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'buyer',
    emoji: '🛒',
    title: 'Покупатель',
    caption: 'Закупаю товар для ларька',
    href: '/buyer',
  },
  {
    role: 'seller',
    emoji: '📦',
    title: 'Продавец',
    caption: 'Продаю оптом на рынке',
    href: '/seller',
  },
  {
    role: 'driver',
    emoji: '🚚',
    title: 'Доставщик',
    caption: 'Доставляю попутно',
    href: '/driver',
  },
];

export interface PlaceholderCard {
  emoji: string;
  title: string;
  caption: string;
  badge: { label: string; variant: BadgeVariant };
}

/** Покупатель: часто закупают. */
export const BUYER_FREQUENT: PlaceholderCard[] = [
  {
    emoji: '🥕',
    title: 'Морковь',
    caption: '38 ₽/кг · опт от 50 кг',
    badge: { label: 'Свежая', variant: 'primary' },
  },
  {
    emoji: '🧅',
    title: 'Лук репчатый',
    caption: '25 ₽/кг · опт от 30 кг',
    badge: { label: 'Осталось мало', variant: 'warning' },
  },
  {
    emoji: '🥔',
    title: 'Картофель',
    caption: '30 ₽/кг · опт от 100 кг',
    badge: { label: 'Новая партия', variant: 'neutral' },
  },
];

/** Продавец: прайс на сегодня. */
export const SELLER_PRICES: PlaceholderCard[] = [
  {
    emoji: '🥕',
    title: 'Морковь',
    caption: '38 ₽/кг · осталось 2 т',
    badge: { label: 'Спрос есть', variant: 'primary' },
  },
  {
    emoji: '🍅',
    title: 'Помидоры',
    caption: '95 ₽/кг · осталось 400 кг',
    badge: { label: 'Мало', variant: 'warning' },
  },
  {
    emoji: '🥔',
    title: 'Картофель',
    caption: '30 ₽/кг · осталось 5 т',
    badge: { label: 'Идёт ровно', variant: 'neutral' },
  },
];

/** Продавец: заказы на утро. */
export const SELLER_ORDERS: PlaceholderCard[] = [
  {
    emoji: '🏪',
    title: 'Ларёк №12',
    caption: 'Морковь · 50 кг · забрать до 6:00',
    badge: { label: 'Оплата на месте', variant: 'primary' },
  },
  {
    emoji: '🏪',
    title: 'Ларёк №7',
    caption: 'Лук · 30 кг · забрать до 7:00',
    badge: { label: 'Предоплата', variant: 'neutral' },
  },
];

/** Доставщик: попутные маршруты. */
export const DRIVER_ROUTES: PlaceholderCard[] = [
  {
    emoji: '🚚',
    title: 'Рынок → Ларёк №12',
    caption: '4 км · нужно успеть до 6:00',
    badge: { label: 'Свободно', variant: 'primary' },
  },
  {
    emoji: '🚐',
    title: 'Рынок → Ларёк №7',
    caption: '7 км · нужно успеть до 7:00',
    badge: { label: 'Занято', variant: 'neutral' },
  },
  {
    emoji: '🛻',
    title: 'Рынок → кафе «Утро»',
    caption: '12 км · нужно успеть до 8:00',
    badge: { label: 'Срочно', variant: 'warning' },
  },
];

/** Подпись-честность: экраны пока без бизнес-логики. */
export const STUB_NOTE = 'Экран-заглушка · бизнес-логика появится на следующем этапе';
