/**
 * Токены внедрения зависимостей и веса публичного рейтинга (ADR-013).
 *
 * Все веса конфигурируются через ENV — значения по умолчанию закреплены
 * спецификацией v0.5.0-A. Изменение весов меняет рейтинг при следующем
 * пересчёте (пересчёт идемпотентен и пересчитывает историю целиком).
 */

/** Минимум взвешенных событий для появления score (ENV RATING_MIN_DEALS). */
export const RATING_MIN_DEALS = 'RATING_MIN_DEALS';

/** Значение по умолчанию: 5 событий — защита новичков от «нулевого» рейтинга. */
export const DEFAULT_RATING_MIN_DEALS = 5;

/** Сделок пары «покупатель — продавец» в окне, выше — анти-накрутка. */
export const RATING_MAX_PAIR_DEALS = 'RATING_MAX_PAIR_DEALS';

/** Значение по умолчанию: >10 сделок пары за 30 дней — «дружеская» накрутка. */
export const DEFAULT_RATING_MAX_PAIR_DEALS = 10;

/** Окно анти-накрутки в днях (ENV RATING_PAIR_WINDOW_DAYS). */
export const RATING_PAIR_WINDOW_DAYS = 'RATING_PAIR_WINDOW_DAYS';

/** Значение по умолчанию: 30 дней. */
export const DEFAULT_RATING_PAIR_WINDOW_DAYS = 30;

/** Вес успешной сделки (qualityFlag=ok) — явное подтверждение приёмки. */
export const RATING_WEIGHT_OK = 'RATING_WEIGHT_OK';

/** Значение по умолчанию: 1.0 — максимум доверия. */
export const DEFAULT_RATING_WEIGHT_OK = 1.0;

/** Вес сделки с мелкими проблемами (qualityFlag=minor_issue). */
export const RATING_WEIGHT_MINOR = 'RATING_WEIGHT_MINOR';

/** Значение по умолчанию: 0.5 — сделка состоялась, но не идеально. */
export const DEFAULT_RATING_WEIGHT_MINOR = 0.5;

/** Вес авто-подтверждения (system_auto_confirmed). */
export const RATING_WEIGHT_AUTO = 'RATING_WEIGHT_AUTO';

/** Значение по умолчанию: 0.3 — меньше явного: покупатель не участвовал. */
export const DEFAULT_RATING_WEIGHT_AUTO = 0.3;

/** Абсолютный вес спора (delivery_disputed / debt disputed). */
export const RATING_WEIGHT_DISPUTE = 'RATING_WEIGHT_DISPUTE';

/** Значение по умолчанию: 1.0 (вычитается из positives). */
export const DEFAULT_RATING_WEIGHT_DISPUTE = 1.0;

/** Вес сделки пары при сработавшей анти-накрутке. */
export const RATING_PAIR_CAP_WEIGHT = 'RATING_PAIR_CAP_WEIGHT';

/** Значение по умолчанию: 0.3 — сделка считается, но почти не двигает score. */
export const DEFAULT_RATING_PAIR_CAP_WEIGHT = 0.3;

/** Штраф арбитража «против стороны» (v0.6.0-C, ADR-033):
 * favor_buyer → продавцу, favor_seller → покупателю. */
export const RATING_WEIGHT_ARBITRATION_LOSS = 'RATING_WEIGHT_ARBITRATION_LOSS';

/** Значение по умолчанию: 1.0 — решение арбитра против стороны (по модулю). */
export const DEFAULT_RATING_WEIGHT_ARBITRATION_LOSS = 1.0;

/** Штраф арбитража при компромиссе (ADR-033): обеим сторонам. */
export const RATING_WEIGHT_ARBITRATION_COMPROMISE = 'RATING_WEIGHT_ARBITRATION_COMPROMISE';

/** Значение по умолчанию: 0.5 — обоюдная вина, обоюдный штраф (по модулю). */
export const DEFAULT_RATING_WEIGHT_ARBITRATION_COMPROMISE = 0.5;

/** Причина отсутствия рейтинга в API-ответе (порог не достигнут). */
export const RATING_MIN_DEALS_REASON = 'min_deals_not_reached' as const;
