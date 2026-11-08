/**
 * Датасет демо-рынка для сида (v0.8.0-C) — чистые данные без Prisma,
 * чтобы юнит-тест (src/prisma/seed.dataset.spec.ts) проверял инварианты
 * набора: количество ролей, уникальность телефонов/заголовков, формат
 * фото-URL, статусы броней. Изменения датасета, ломающие «живой рынок»
 * (например, 10 продавцов вместо 15), роняют CI до попадания в БД.
 */

export type Category = 'vegetables' | 'fruits' | 'grocery' | 'snacks' | 'other';
export type Unit = 'kg' | 'box' | 'piece';

/** Продавцы: линии 1–15, телефоны +79000000001..15. */
export const SELLERS: ReadonlyArray<{
  phone: string;
  name: string;
  line: number;
  rep: number;
}> = [
  { phone: '+79000000001', name: 'Арутюн Мкртчян — линия 1, овощи', line: 1, rep: 4.9 },
  { phone: '+79000000002', name: 'Гагик Ованесян — линия 2, фрукты', line: 2, rep: 4.8 },
  { phone: '+79000000003', name: 'Семён Ковтун — линия 3, корнеплоды', line: 3, rep: 4.6 },
  { phone: '+79000000004', name: 'Марат Алиев — линия 4, цитрусы', line: 4, rep: 4.7 },
  { phone: '+79000000005', name: 'Иване Кабадзе — линия 5, овощи', line: 5, rep: 4.5 },
  { phone: '+79000000006', name: 'Ольга Дьяченко — линия 6, бакалея', line: 6, rep: 4.9 },
  { phone: '+79000000007', name: 'Руслан Ахмедов — линия 7, бакалея', line: 7, rep: 4.4 },
  { phone: '+79000000008', name: 'Давид Саакян — линия 8, сухофрукты', line: 8, rep: 4.8 },
  { phone: '+79000000009', name: 'Татьяна Гордиенко — линия 9, корнеплоды', line: 9, rep: 4.3 },
  { phone: '+79000000010', name: 'Эльдар Мамедов — линия 10, тропические фрукты', line: 10, rep: 4.6 },
  { phone: '+79000000011', name: 'Валентина Пригода — линия 11, орехи и семечки', line: 11, rep: 4.9 },
  { phone: '+79000000012', name: 'Ашот Казарян — линия 12, снеки', line: 12, rep: 4.7 },
  { phone: '+79000000013', name: 'Николай Шевченко — линия 13, сухофрукты', line: 13, rep: 4.5 },
  { phone: '+79000000014', name: 'Зулихан Ибрагимова — линия 14, зелень и салаты', line: 14, rep: 4.8 },
  { phone: '+79000000015', name: 'Аркадий Погосян — линия 15, мёд и заготовки', line: 15, rep: 5.0 },
];

/** Покупатели-ларёчники: телефоны +79000000016..20. */
export const BUYERS: ReadonlyArray<{ phone: string; name: string; rep: number }> = [
  { phone: '+79000000016', name: 'Марина Ковалёва — ларёк «Заря», ЗЖМ', rep: 4.7 },
  { phone: '+79000000017', name: 'Игорь Ларин — ларёк у вокзала', rep: 4.4 },
  { phone: '+79000000018', name: 'Людмила Ерёменко — павильон «Продукты», Левенцовка', rep: 4.6 },
  { phone: '+79000000019', name: 'Хасан Юсупов — ларёк «Уют», Западный', rep: 4.5 },
  { phone: '+79000000020', name: 'Анна Белозёрова — кафе-ларёк «Студенческий»', rep: 4.8 },
];

/** Водители: телефоны +79000000021..22. */
export const DRIVERS: ReadonlyArray<{ phone: string; name: string; rep: number }> = [
  { phone: '+79000000021', name: 'Виталий Гончаров — Газель Next', rep: 4.9 },
  { phone: '+79000000022', name: 'Артём Белов — LADA Largus фургон', rep: 4.6 },
];

/** Арбитр рынка: телефон +79000000023. */
export const ARBITRATOR = { phone: '+79000000023', name: 'Левон Карапетян — арбитр рынка' };

/** Лот демо-рынка. sellerIdx — индекс в SELLERS (0-based). */
export interface DemoListing {
  sellerIdx: number;
  title: string;
  category: Category;
  unit: Unit;
  pricePerUnit: number;
  quantityAvailable: number;
  isPerishable?: boolean;
  /** Слаг фото (picsum): наличие = лот с обложкой. */
  photoSlug?: string;
}

export const LISTINGS: ReadonlyArray<DemoListing> = [
  // Линия 1 — Арутюн: овощи
  { sellerIdx: 0, title: 'Помидоры розовые', category: 'vegetables', unit: 'kg', pricePerUnit: 85.5, quantityAvailable: 240, isPerishable: true, photoSlug: 'tomato-pink' },
  { sellerIdx: 0, title: 'Огурцы гладкие', category: 'vegetables', unit: 'kg', pricePerUnit: 72, quantityAvailable: 180, isPerishable: true, photoSlug: 'cucumber' },
  { sellerIdx: 0, title: 'Перец болгарский красный', category: 'vegetables', unit: 'kg', pricePerUnit: 140, quantityAvailable: 90, isPerishable: true, photoSlug: 'pepper-red' },
  // Линия 2 — Гагик: фрукты
  { sellerIdx: 1, title: 'Яблоки «Гала»', category: 'fruits', unit: 'kg', pricePerUnit: 60, quantityAvailable: 320, isPerishable: true, photoSlug: 'apple-gala' },
  { sellerIdx: 1, title: 'Груши «Конференц»', category: 'fruits', unit: 'kg', pricePerUnit: 115, quantityAvailable: 140, isPerishable: true },
  { sellerIdx: 1, title: 'Виноград «Кишмиш»', category: 'fruits', unit: 'kg', pricePerUnit: 160, quantityAvailable: 80, isPerishable: true, photoSlug: 'grape-kishmish' },
  // Линия 3 — Семён: корнеплоды
  { sellerIdx: 2, title: 'Картофель молодой', category: 'vegetables', unit: 'kg', pricePerUnit: 41, quantityAvailable: 500, photoSlug: 'potato-young' },
  { sellerIdx: 2, title: 'Лук репчатый (мешок 25 кг)', category: 'vegetables', unit: 'box', pricePerUnit: 640, quantityAvailable: 40 },
  { sellerIdx: 2, title: 'Капуста белокочанная', category: 'vegetables', unit: 'kg', pricePerUnit: 28, quantityAvailable: 400 },
  // Линия 4 — Марат: цитрусы
  { sellerIdx: 3, title: 'Мандарины (Турция)', category: 'fruits', unit: 'kg', pricePerUnit: 95, quantityAvailable: 260, isPerishable: true, photoSlug: 'mandarin' },
  { sellerIdx: 3, title: 'Апельсины столовые', category: 'fruits', unit: 'kg', pricePerUnit: 88, quantityAvailable: 200, isPerishable: true },
  { sellerIdx: 3, title: 'Хурма «Королёк»', category: 'fruits', unit: 'kg', pricePerUnit: 110, quantityAvailable: 90, isPerishable: true },
  // Линия 5 — Иване: овощи
  { sellerIdx: 4, title: 'Баклажаны', category: 'vegetables', unit: 'kg', pricePerUnit: 95, quantityAvailable: 120, isPerishable: true },
  { sellerIdx: 4, title: 'Кабачки', category: 'vegetables', unit: 'kg', pricePerUnit: 64, quantityAvailable: 150, isPerishable: true },
  { sellerIdx: 4, title: 'Зелень (укроп, петрушка)', category: 'vegetables', unit: 'kg', pricePerUnit: 180, quantityAvailable: 40, isPerishable: true },
  // Линия 6 — Ольга: бакалея
  { sellerIdx: 5, title: 'Гречневая крупа', category: 'grocery', unit: 'kg', pricePerUnit: 68, quantityAvailable: 300, photoSlug: 'buckwheat' },
  { sellerIdx: 5, title: 'Рис круглозёрный', category: 'grocery', unit: 'kg', pricePerUnit: 74, quantityAvailable: 280 },
  { sellerIdx: 5, title: 'Сахар-песок', category: 'grocery', unit: 'kg', pricePerUnit: 56, quantityAvailable: 400 },
  // Линия 7 — Руслан: бакалея
  { sellerIdx: 6, title: 'Масло подсолнечное (бутыль 5 л)', category: 'grocery', unit: 'piece', pricePerUnit: 540, quantityAvailable: 60, photoSlug: 'sunflower-oil' },
  { sellerIdx: 6, title: 'Мука пшеничная в/с', category: 'grocery', unit: 'kg', pricePerUnit: 42, quantityAvailable: 350 },
  { sellerIdx: 6, title: 'Макаронные изделия', category: 'grocery', unit: 'kg', pricePerUnit: 52, quantityAvailable: 260 },
  // Линия 8 — Давид: сухофрукты
  { sellerIdx: 7, title: 'Гранат «Ачик-анор»', category: 'fruits', unit: 'kg', pricePerUnit: 150, quantityAvailable: 70, isPerishable: true, photoSlug: 'pomegranate' },
  { sellerIdx: 7, title: 'Финики «Маджхоль»', category: 'fruits', unit: 'kg', pricePerUnit: 240, quantityAvailable: 50 },
  { sellerIdx: 7, title: 'Курага', category: 'grocery', unit: 'kg', pricePerUnit: 260, quantityAvailable: 45 },
  // Линия 9 — Татьяна: корнеплоды
  { sellerIdx: 8, title: 'Свёкла столовая', category: 'vegetables', unit: 'kg', pricePerUnit: 35, quantityAvailable: 200 },
  { sellerIdx: 8, title: 'Морковь мытая', category: 'vegetables', unit: 'kg', pricePerUnit: 38, quantityAvailable: 240, photoSlug: 'carrot' },
  { sellerIdx: 8, title: 'Чеснок озимый', category: 'vegetables', unit: 'kg', pricePerUnit: 180, quantityAvailable: 60 },
  // Линия 10 — Эльдар: тропические
  { sellerIdx: 9, title: 'Бананы (Эквадор)', category: 'fruits', unit: 'kg', pricePerUnit: 75, quantityAvailable: 300, isPerishable: true, photoSlug: 'banana' },
  { sellerIdx: 9, title: 'Лимоны', category: 'fruits', unit: 'kg', pricePerUnit: 105, quantityAvailable: 120, isPerishable: true },
  // Линия 11 — Валентина: орехи
  { sellerIdx: 10, title: 'Семечки жареные (мешок 25 кг)', category: 'snacks', unit: 'box', pricePerUnit: 2100, quantityAvailable: 20, photoSlug: 'sunflower-seeds' },
  { sellerIdx: 10, title: 'Арахис жареный', category: 'snacks', unit: 'kg', pricePerUnit: 190, quantityAvailable: 90 },
  { sellerIdx: 10, title: 'Кешью сырой', category: 'snacks', unit: 'kg', pricePerUnit: 520, quantityAvailable: 30 },
  // Линия 12 — Ашот: снеки
  { sellerIdx: 11, title: 'Сухарики «Три корочки» (коробка)', category: 'snacks', unit: 'box', pricePerUnit: 1250, quantityAvailable: 24 },
  { sellerIdx: 11, title: 'Чипсы (мешок ассорти)', category: 'snacks', unit: 'box', pricePerUnit: 1800, quantityAvailable: 15 },
  // Линия 13 — Николай: сухофрукты
  { sellerIdx: 12, title: 'Изюм «Султана»', category: 'grocery', unit: 'kg', pricePerUnit: 190, quantityAvailable: 80 },
  { sellerIdx: 12, title: 'Грецкий орех (очищенный)', category: 'grocery', unit: 'kg', pricePerUnit: 340, quantityAvailable: 60 },
  // Линия 14 — Зулихан: зелень
  { sellerIdx: 13, title: 'Помидоры «Черри»', category: 'vegetables', unit: 'kg', pricePerUnit: 210, quantityAvailable: 40, isPerishable: true, photoSlug: 'cherry-tomato' },
  { sellerIdx: 13, title: 'Салат листовой', category: 'vegetables', unit: 'kg', pricePerUnit: 240, quantityAvailable: 25, isPerishable: true },
  // Линия 15 — Аркадий: мёд
  { sellerIdx: 14, title: 'Мёд разнотравье (банка 3 л)', category: 'other', unit: 'piece', pricePerUnit: 950, quantityAvailable: 30, photoSlug: 'honey' },
  { sellerIdx: 14, title: 'Варенье домашнее (банка 3 л)', category: 'other', unit: 'piece', pricePerUnit: 480, quantityAvailable: 40 },
];

/**
 * Фото лотов (v0.7.0-D, ADR-038): внешние URL picsum.photos — детерминиро-
 * ваны слагом (одинаковая картинка у всех прогонов), рендерятся клиентом
 * без S3: API отдаёт не-s3:// fileUrl как есть.
 */
export const photoUrl = (slug: string): string => `https://picsum.photos/seed/agromoll-${slug}/800/600`;

/** Стабильный «размер файла» — без запросов к сети, только для метаданных. */
export const photoBytes = (slug: string): number => 60_000 + (slug.length * 7_919) % 120_000;
