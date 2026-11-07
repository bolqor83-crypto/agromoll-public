import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import {
  LISTING_CATEGORIES,
  LISTING_CATEGORY_LABELS,
  LISTING_UNITS,
  LISTING_UNIT_LABELS,
} from '@agromoll/types';
import type { ListingCategory, ListingUnit } from '@agromoll/types';
import {
  Button,
  Card,
  Icon,
  Input,
  radius,
  ShakeField,
  spacing,
  success,
  tap,
  Text,
  useTheme,
  warning,
} from '@agromoll/ui';
import { api, ApiError } from '@/lib/api';
import { pickPhotosAndCompress, type PreparedPhoto } from '@/lib/media/photo';
import { uploadListingPhoto } from '@/lib/media/photo-upload';
import { logger } from '@/lib/logger';
import { SheetModal } from './SheetModal';

/** Максимум фото на лот (ADR-038): совпадает с лимитом сервера. */
const MAX_PHOTOS = 5;

export interface CreateListingModalProps {
  visible: boolean;
  demo: boolean;
  onClose: () => void;
  /** Лот создан — обновить витрину. */
  onCreated: () => void;
}

/**
 * Модалка «Выставить лот» (seller): заглушка v0.2.0 с полями
 * title / category / unit / price / quantity. Если API доступен —
 * лот реально создаётся (POST /listings), иначе честно предупреждаем.
 */
export function CreateListingModal({ visible, demo, onClose, onCreated }: CreateListingModalProps) {
  const { colors } = useTheme();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ListingCategory>('vegetables');
  const [unit, setUnit] = useState<ListingUnit>('kg');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [sending, setSending] = useState(false);
  // Фото товара (v0.7.0-D, ADR-038): выбираются до отправки, грузятся
  // ПОСЛЕ создания лота по очереди (позиция = порядок). Превью — сжатые
  // копии из манипулятора, сами байты ждут в памяти.
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);

  const parsedPrice = useMemo(() => Number.parseFloat(price.replace(',', '.')), [price]);
  const parsedQuantity = useMemo(() => Number.parseInt(quantity, 10), [quantity]);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0;
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0;
  const formValid = title.trim().length >= 2 && priceValid && quantityValid;

  // v0.6.1-E2 (ADR-027): цена/количество стали невалидными — качаем поле.
  const [priceShake, setPriceShake] = useState(0);
  const [quantityShake, setQuantityShake] = useState(0);
  const priceWasValid = useRef(true);
  const quantityWasValid = useRef(true);
  useEffect(() => {
    if (price.length > 0 && !priceValid && priceWasValid.current) {
      setPriceShake((k) => k + 1);
    }
    priceWasValid.current = priceValid || price.length === 0;
  }, [priceValid, price]);
  useEffect(() => {
    if (quantity.length > 0 && !quantityValid && quantityWasValid.current) {
      setQuantityShake((k) => k + 1);
    }
    quantityWasValid.current = quantityValid || quantity.length === 0;
  }, [quantityValid, quantity]);

  const reset = (): void => {
    setTitle('');
    setCategory('vegetables');
    setUnit('kg');
    setPrice('');
    setQuantity('');
    setPhotos([]);
  };

  /** Добавить фото из галереи (мультивыбор до остатка слотов). */
  const addPhotos = async (): Promise<void> => {
    tap();
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      return;
    }
    try {
      const picked = await pickPhotosAndCompress(remaining);
      setPhotos((current) => [...current, ...picked].slice(0, MAX_PHOTOS));
    } catch (err) {
      logger.warn('listing-photos', 'не удалось выбрать фото', { err: String(err) });
    }
  };

  const send = async (): Promise<void> => {
    if (demo) {
      tap();
      Alert.alert(
        'Демо-режим',
        'API недоступен — лот не сохранён. Поднимите pnpm dev, чтобы выставлять лоты по-настоящему.',
      );
      reset();
      onClose();
      return;
    }
    setSending(true);
    try {
      const created = await api.createListing({
        title: title.trim(),
        category,
        unit,
        pricePerUnit: parsedPrice,
        quantityAvailable: parsedQuantity,
      });

      // Фото грузятся ПОСЛЕ создания лота: ошибка фото не должна ронять
      // лот (некритичные данные, ADR-038). Счётчик неудач — для честного
      // предупреждения, а не молчаливой потери.
      let failed = 0;
      for (const photo of photos) {
        const result = await uploadListingPhoto(created.id, photo);
        if (!result.ok) {
          failed += 1;
        }
      }

      success();
      reset();
      onCreated();
      if (failed > 0) {
        Alert.alert(
          'Лот создан, но не всё фото загрузились',
          `Загружено ${photos.length - failed} из ${photos.length}. Лот работает — фото можно будет добавить позже.`,
        );
      }
    } catch (error) {
      warning();
      const hint = error instanceof ApiError ? error.hint : undefined;
      Alert.alert('Не получилось', hint ?? 'Проверьте соединение с API и попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <Card elevated style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="title">Выставить лот</Text>
          <Text variant="caption" color="secondary">
            Покупатели увидят лот в ленте сразу после публикации.
          </Text>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" color="secondary">
            Название
          </Text>
          <Input placeholder="Помидоры розовые" value={title} onChangeText={setTitle} />
        </View>

        {/* Фото товара (v0.7.0-D): первое — обложка в ленте. */}
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" color="secondary">
            Фото · {photos.length}/{MAX_PHOTOS}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {photos.map((photo, index) => (
              <Pressable
                key={`${photo.previewUri}-${index}`}
                accessibilityLabel={`Убрать фото ${index + 1}`}
                onPress={() => {
                  tap();
                  setPhotos((current) => current.filter((_, i) => i !== index));
                }}
                style={{ width: 64, height: 64 }}
              >
                <Image
                  source={{ uri: photo.previewUri }}
                  style={{ width: '100%', height: '100%', borderRadius: radius.md }}
                  resizeMode="cover"
                />
                <View
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="close-circle" size={20} color="secondary" />
                </View>
              </Pressable>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Добавить фото из галереи"
                onPress={() => void addPhotos()}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderStyle: 'dashed',
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="camera-outline" size={24} color="secondary" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" color="secondary">
            Категория
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {LISTING_CATEGORIES.map((item) => (
              <Chip
                key={item}
                label={LISTING_CATEGORY_LABELS[item]}
                active={category === item}
                onPress={() => setCategory(item)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" color="secondary">
            Единица
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {LISTING_UNITS.map((item) => (
              <Chip
                key={item}
                label={LISTING_UNIT_LABELS[item]}
                active={unit === item}
                onPress={() => setUnit(item)}
              />
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="caption" color="secondary">
              Цена за единицу, ₽
            </Text>
            <ShakeField shakeKey={priceShake}>
              <Input
                placeholder="85,50"
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
              />
            </ShakeField>
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="caption" color="secondary">
              Количество
            </Text>
            <ShakeField shakeKey={quantityShake}>
              <Input
                placeholder="120"
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
              />
            </ShakeField>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button title="Отмена" variant="ghost" onPress={onClose} disabled={sending} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Выставить"
              onPress={() => void send()}
              loading={sending}
              disabled={!formValid || sending}
            />
          </View>
        </View>
        <View
          style={{
            height: 2,
            borderRadius: 1,
            backgroundColor: colors.border,
            alignSelf: 'center',
            width: 36,
          }}
        />
      </Card>
    </SheetModal>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={{
        paddingHorizontal: spacing.md,
        height: 40,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primaryMuted : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="caption" weight="600" color={active ? 'primary' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}
