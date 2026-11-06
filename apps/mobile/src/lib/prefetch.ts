/**
 * Prefetch чанков экранов (v0.6.1-A, ADR-023).
 *
 * Динамический import() уже загруженного Metro-модуля разрешается
 * мгновенно из кэша — «прогрев» безопасен и идемпотентен. На web это
 * подтягивает js-чанки заранее, и первый переход по вкладке роли
 * происходит без задержки на сеть; на native все модули уже в бандле,
 * вызов фактически бесплатен.
 *
 * Изоляция ролей сохраняется: префетчим ТОЛЬКО экраны текущей роли —
 * покупатель не грузит код продавца и доставщика (ADR-023).
 */

/** Вкладки покупателя (лента, брони, доставка, долги). */
export function prefetchBuyerTabs(): Promise<unknown> {
  return Promise.allSettled([
    import('@/screens/FeedScreen'),
    import('@/screens/BookingsScreen'),
    import('@/screens/DeliveryScreen'),
    import('@/components/DebtsScreen'),
  ]);
}

/** Вкладки продавца (витрина, входящие, долги, часы). */
export function prefetchSellerTabs(): Promise<unknown> {
  return Promise.allSettled([
    import('@/screens/ShowcaseScreen'),
    import('@/screens/InboxScreen'),
    import('@/components/DebtsScreen'),
    import('@/components/WorkHoursScreen'),
  ]);
}

/** Вкладки доставщика (радар, мои доставки, часы). */
export function prefetchDriverTabs(): Promise<unknown> {
  return Promise.allSettled([
    import('@/screens/RadarScreen'),
    import('@/screens/MyDeliveriesScreen'),
    import('@/components/WorkHoursScreen'),
  ]);
}

/** Карта рынка — общий экран вне вкладок, открывается с роли любого типа. */
export function prefetchMapScreen(): Promise<unknown> {
  return Promise.allSettled([import('@/components/MarketMapScreen')]);
}
