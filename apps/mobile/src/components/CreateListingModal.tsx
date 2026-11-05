import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import {
  LISTING_CATEGORIES,
  LISTING_CATEGORY_LABELS,
  LISTING_UNITS,
  LISTING_UNIT_LABELS,
} from '@agromoll/types';
import type { ListingCategory, ListingUnit } from '@agromoll/types';
import { Button, Card, Input, radius, spacing, Text, useTheme } from '@agromoll/ui';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';

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
export function CreateListingModal({
  visible,
  demo,
  onClose,
  onCreated,
}: CreateListingModalProps) {
  const { colors } = useTheme();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ListingCategory>('vegetables');
  const [unit, setUnit] = useState<ListingUnit>('kg');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [sending, setSending] = useState(false);

  const parsedPrice = useMemo(() => Number.parseFloat(price.replace(',', '.')), [price]);
  const parsedQuantity = useMemo(() => Number.parseInt(quantity, 10), [quantity]);
  const formValid =
    title.trim().length >= 2 &&
    Number.isFinite(parsedPrice) &&
    parsedPrice > 0 &&
    Number.isInteger(parsedQuantity) &&
    parsedQuantity > 0;

  const reset = (): void => {
    setTitle('');
    setCategory('vegetables');
    setUnit('kg');
    setPrice('');
    setQuantity('');
  };

  const send = async (): Promise<void> => {
    if (demo) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
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
      await api.createListing({
        title: title.trim(),
        category,
        unit,
        pricePerUnit: parsedPrice,
        quantityAvailable: parsedQuantity,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      reset();
      onCreated();
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const hint = error instanceof ApiError ? error.hint : undefined;
      Alert.alert('Не получилось', hint ?? 'Проверьте соединение с API и попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,20,17,0.45)' }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
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
                <Input
                  placeholder="85,50"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="caption" color="secondary">
                  Количество
                </Text>
                <Input
                  placeholder="120"
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="number-pad"
                />
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
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
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
