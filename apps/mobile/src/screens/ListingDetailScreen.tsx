import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  SkeletonCard,
  spacing,
  success,
  tap,
  Text,
  useTheme,
  warning,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, ApiError } from '@/lib/api';
import { createBookingMutation } from '@/lib/outbox/mutations';
import { useOutboxStore } from '@/store/outbox';
import { consumeTransitionOrigin } from '@/lib/transition';
import type { ScreenFrame } from '@/lib/transition';
import { formatAvailable, formatPrice } from '@/lib/format';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';

/** Шаг изменения количества — крупные кнопки для работы в перчатках. */
const QTY_STEP = 5;

/** Пружина морфа «фото карточки → шапка экрана» (v0.3.1, ADR-009). */
const MORPH_SPRING = { damping: 18, mass: 0.85, stiffness: 220 };
/** Страховка: если measureInWindow не ответил (платформа), просто показываем. */
const MEASURE_FALLBACK_MS = 250;

/**
 * Детальный экран лота: карточка товара, выбор количества, бронирование.
 * Переход из ленты — плавный spring (Reanimated entering), общий визуальный
 * язык с карточкой ленты (v0.2.0: полноценный shared-element-transition
 * отложен — см. ADR-005).
 */
export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [listing, setListing] = useState<ListingDto | null>(null);
  const [demo, setDemo] = useState(false);
  const [quantity, setQuantity] = useState(QTY_STEP);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Морф «карточка раскрывается в экран» (v0.3.1, ADR-009) ──
  // Фрейм-источник забираем ОДНОРАЗОВО: повторное открытие того же экрана
  // (или заход без ленты) — обычный fade-in.
  const [origin, setOrigin] = useState<ScreenFrame | null>(() =>
    consumeTransitionOrigin(String(id)),
  );
  const [target, setTarget] = useState<ScreenFrame | null>(null);
  const reducedMotion = useReducedMotion();
  const morph = useSharedValue(origin ? 0 : 1);
  const photoRef = useRef<View>(null);

  const measurePhoto = useCallback((): void => {
    if (!origin || target) {
      return;
    }
    photoRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setTarget({ x, y, width, height });
        // v0.6.1-E2 (ADR-027): reduced motion — морф мгновенный,
        // без spring-пробега фрейма.
        morph.value = 0;
        morph.value = reducedMotion ? 1 : withSpring(1, MORPH_SPRING);
      } else {
        setOrigin(null); // не вышло — не морфим, просто показываем
      }
    });
  }, [origin, target, morph, reducedMotion]);

  // Страховка для платформ без measureInWindow: фото не должно висеть невидимым.
  useEffect(() => {
    if (!origin) {
      return;
    }
    const timer = setTimeout(() => {
      setOrigin((current) => (current && !target ? null : current));
    }, MEASURE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [origin, target]);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const found = await api.listing(String(id));
        setListing(found);
      } catch {
        // Демо-режим: лента могла быть загружена из демо-данных.
        setListing(DEMO_LISTINGS.find((l) => l.id === id) ?? DEMO_LISTINGS[0]);
        setDemo(true);
      }
    })();
  }, [id]);

  const isOnline = useOutboxStore((s) => s.isOnline);

  const book = async (): Promise<void> => {
    if (!listing) return;
    if (demo) {
      tap();
      Alert.alert(
        'Демо-режим',
        'API недоступен — бронь не создана. Поднимите pnpm dev, чтобы бронировать по-настоящему.',
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      // v0.3.0: бронь уходит через локальный outbox — работает и офлайн,
      // UI покажет её в «Моих бронях» с пометкой «Ждёт сети».
      await createBookingMutation({
        listingId: listing.id,
        requestedQuantity: quantity,
        listingTitle: listing.title,
        listingUnit: listing.unit,
      });
      success();
      Alert.alert(
        isOnline ? 'Забронировано' : 'Заявка сохранена',
        isOnline
          ? `«${listing.title}» — ${quantity} ждёт подтверждения продавца (30 минут).`
          : `Сети нет — «${listing.title}» (${quantity}) сохранено в очередь и уйдёт продавцу, как только появится связь.`,
        [
          { text: 'К моим броням', onPress: () => router.push('/(buyer)/bookings') },
          { text: 'Остаться', style: 'cancel' },
        ],
      );
    } catch (err) {
      warning();
      const hint = err instanceof ApiError ? err.hint : undefined;
      setError(hint ?? 'Не получилось сохранить бронь. Попробуйте ещё раз.');
      logger.warn('booking', 'не удалось поставить бронь в очередь', { error: String(err) });
    } finally {
      setSending(false);
    }
  };

  // Геометрия морфа: интерполяция фрейма-источника → финальный фрейм фото.
  // Transform'ы вокруг ЦЕНТРА: сначала сдвигаем центр к источнику, потом
  // масштабируем до размеров источника; spring доводит всё до identity.
  const photoStyle = useAnimatedStyle(() => {
    if (!origin || !target) {
      return {};
    }
    const scaleX0 = origin.width / target.width;
    const scaleY0 = origin.height / target.height;
    const dx0 = origin.x + origin.width / 2 - (target.x + target.width / 2);
    const dy0 = origin.y + origin.height / 2 - (target.y + target.height / 2);
    const t = 1 - morph.value;
    return {
      transform: [
        { translateX: dx0 * t },
        { translateY: dy0 * t },
        { scaleX: scaleX0 + (1 - scaleX0) * (1 - t) },
        { scaleY: scaleY0 + (1 - scaleY0) * (1 - t) },
      ],
    };
  });
  // Фото скрыто только пока морф «взводится» (замер), и только если источник есть.
  const photoHidden = Boolean(origin && !target);

  if (!listing) {
    return (
      <Screen>
        <ScreenHeader title="Лот" subtitle="Загружаем…" />
        <SkeletonCard />
      </Screen>
    );
  }

  const maxQty = Math.max(1, Math.min(listing.quantityAvailableForBooking, 999));

  return (
    <Screen>
      <ScreenHeader
        title={listing.title}
        subtitle={`${listing.sellerName ?? 'Продавец'}${listing.lineNumber !== null ? ` · линия ${listing.lineNumber}` : ''}`}
        badge={demo ? <Badge label="Демо-данные" variant="attention" /> : undefined}
      />

      <Animated.View
        entering={FadeInDown.springify().damping(15).stiffness(180)}
        style={{ gap: spacing.lg }}
      >
        <Card style={{ gap: spacing.md }}>
          {/* v0.6.2-B (ADR-028): «фото» 4:3 (была фикс. высота 148) +
              мягкий градиент снизу — когда появятся реальные фото,
              текст поверх будет читаться (спека этапа). */}
          <Animated.View
            ref={photoRef}
            onLayout={measurePhoto}
            style={[
              photoStyle,
              {
                aspectRatio: 4 / 3,
                borderRadius: 16,
                backgroundColor: colors.primaryMuted,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: photoHidden ? 0 : 1,
                overflow: 'hidden',
              },
            ]}
          >
            <Icon name="leaf-outline" size={64} color="primary" />
          </Animated.View>

          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text variant="title" color="primary" numeric>
              {formatPrice(listing.pricePerUnit, listing.unit)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {listing.isPerishable ? (
                <Badge label="Скоропорт" variant="attention" icon="time-outline" />
              ) : (
                <Badge label="Свежий" variant="success" icon="leaf-outline" />
              )}
              {listing.lineNumber !== null ? (
                <Badge label={`Линия ${listing.lineNumber}`} variant="neutral" />
              ) : null}
            </View>
          </View>

          <Text variant="body" color="secondary">
            {formatAvailable(listing.quantityAvailableForBooking, listing.unit)}
          </Text>
        </Card>

        <Animated.View entering={FadeInUp.springify().damping(15).stiffness(180).delay(80)}>
          <Card style={{ gap: spacing.md }}>
            <Text variant="body" weight="600">
              Сколько нужно?
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.md,
              }}
            >
              <Button
                title="−5"
                variant="secondary"
                size="md"
                disabled={quantity - QTY_STEP < 1}
                onPress={() => setQuantity((q) => Math.max(1, q - QTY_STEP))}
              />
              <Text variant="display" color="primary">
                {quantity}
              </Text>
              <Button
                title={`+${QTY_STEP}`}
                variant="secondary"
                size="md"
                disabled={quantity + QTY_STEP > maxQty}
                onPress={() => setQuantity((q) => Math.min(maxQty, q + QTY_STEP))}
              />
            </View>
            <Button
              title={`Забронировать ${quantity}`}
              onPress={() => void book()}
              loading={sending}
              disabled={sending || listing.quantityAvailableForBooking < 1}
            />
            {error ? (
              <Text variant="caption" color="onWarning" align="center">
                {error}
              </Text>
            ) : (
              <Text variant="caption" color="muted" align="center">
                Продавец подтвердит или предложит корректировку в течение 30 минут.
              </Text>
            )}
          </Card>
        </Animated.View>
      </Animated.View>
    </Screen>
  );
}
