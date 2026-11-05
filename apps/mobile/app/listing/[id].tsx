import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import {
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  SkeletonCard,
  spacing,
  Text,
  useTheme,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components';
import { api, ApiError } from '@/lib/api';
import { formatAvailable, formatPrice } from '@/lib/format';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';

/** Шаг изменения количества — крупные кнопки для работы в перчатках. */
const QTY_STEP = 5;

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

  const book = async (): Promise<void> => {
    if (!listing) return;
    if (demo) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      Alert.alert(
        'Демо-режим',
        'API недоступен — бронь не создана. Поднимите pnpm dev, чтобы бронировать по-настоящему.',
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.createBooking(listing.id, quantity);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      Alert.alert(
        'Забронировано',
        `«${listing.title}» — ${quantity} ждёт подтверждения продавца (30 минут).`,
        [
          { text: 'К моим броням', onPress: () => router.push('/(buyer)/bookings') },
          { text: 'Остаться', style: 'cancel' },
        ],
      );
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const hint = err instanceof ApiError ? err.hint : undefined;
      setError(hint ?? 'Не получилось создать бронь. Попробуйте ещё раз.');
      logger.warn('booking', 'не удалось создать бронь', { error: String(err) });
    } finally {
      setSending(false);
    }
  };

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
          <View
            style={{
              height: 148,
              borderRadius: 16,
              backgroundColor: colors.primaryMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="leaf-outline" size={64} color="primary" />
          </View>

          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text variant="title" color="primary">
              {formatPrice(listing.pricePerUnit, listing.unit)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {listing.isPerishable ? (
                <Badge label="Скоропорт" variant="attention" />
              ) : (
                <Badge label="Свежий" variant="success" />
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
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  setQuantity((q) => Math.max(1, q - QTY_STEP));
                }}
              />
              <Text variant="display" color="primary">
                {quantity}
              </Text>
              <Button
                title={`+${QTY_STEP}`}
                variant="secondary"
                size="md"
                disabled={quantity + QTY_STEP > maxQty}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  setQuantity((q) => Math.min(maxQty, q + QTY_STEP));
                }}
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
