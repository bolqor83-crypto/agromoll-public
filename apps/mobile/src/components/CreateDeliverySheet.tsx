/**
 * «Заказать доставку» (v0.5.0, подэтап C, ADR-015) — лист создания.
 *
 * Покупатель выбирает: откуда забрать (линии продавцов рядом — PostGIS),
 * куда привезти (мои точки), вес и описание. Отправка — через локальный
 * outbox (create_delivery): работает офлайн, уйдёт при появлении сети
 * (ADR-006/015). Цены нет НАМЕРЕННО — платформа не агент.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  Button,
  Card,
  Icon,
  Input,
  ShakeField,
  spacing,
  success,
  tap,
  Text,
  warning,
} from '@agromoll/ui';
import type { GeoPointDto } from '@agromoll/types';
import { GEO_POINT_KIND_LABELS } from '@agromoll/types';
import { SheetModal } from './SheetModal';
import { MARKET_CENTER } from './MyPointSheet';
import { createDeliveryMutation } from '@/lib/outbox/delivery-mutations';
import { api, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';

/** Радиус поиска линий продавцов (ADR-014/015). */
const NEARBY_RADIUS_M = 2000;

export interface CreateDeliverySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Создано — родитель перечитывает список. */
  onCreated?: () => void;
}

export function CreateDeliverySheet({ visible, onClose, onCreated }: CreateDeliverySheetProps) {
  const [pickupOptions, setPickupOptions] = useState<GeoPointDto[]>([]);
  const [dropoffOptions, setDropoffOptions] = useState<GeoPointDto[]>([]);
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [dropoffPointId, setDropoffPointId] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v0.6.1-E2 (ADR-027): вес вне пределов (0 < вес ≤ 20 000 кг, ADR-015) —
  // качаем поле: вместимость «Газели» не резиновая.
  const weightValid =
    Number.isFinite(Number(weight)) && Number(weight) > 0 && Number(weight) <= 20000;
  const [weightShake, setWeightShake] = useState(0);
  const weightWasValid = useRef(true);
  useEffect(() => {
    if (weight.length > 0 && !weightValid && weightWasValid.current) {
      setWeightShake((k) => k + 1);
    }
    weightWasValid.current = weightValid || weight.length === 0;
  }, [weightValid, weight]);

  /** Загрузить варианты точек: линии продавцов рядом + мои точки. */
  const loadOptions = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      let center = MARKET_CENTER;
      try {
        // v0.6.1-A: динамический импорт — иначе Metro тащит expo-location в entry (ADR-023).
        const { default: Location } = await import('expo-location');
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status === 'granted') {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          center = { lat: position.coords.latitude, lng: position.coords.longitude };
        }
      } catch (err) {
        logger.info('delivery', 'геолокация недоступна — центр рынка', { error: String(err) });
      }
      const [sellers, mine] = await Promise.all([
        api.geoPointsNearby({ lat: center.lat, lng: center.lng, radiusMeters: NEARBY_RADIUS_M, kind: 'seller_line' }),
        api.geoPointsMine(),
      ]);
      setPickupOptions(sellers);
      setDropoffOptions(mine.filter((p) => p.kind === 'buyer_point'));
      // Автовыбор первых подходящих — меньше тапов утром на рынке.
      setPickupPointId((prev) => prev ?? sellers[0]?.id ?? null);
      setDropoffPointId((prev) => prev ?? mine.find((p) => p.kind === 'buyer_point')?.id ?? null);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void loadOptions();
    }
  }, [visible, loadOptions]);

  const canSubmit =
    pickupPointId !== null && dropoffPointId !== null && Number(weight) > 0 && Number(weight) <= 20000;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!pickupPointId || !dropoffPointId) {
      return;
    }
    tap();
    setSubmitting(true);
    try {
      await createDeliveryMutation({
        pickupPointId,
        dropoffPointId,
        weightKg: Math.round(Number(weight) * 100) / 100,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      success();
      onCreated?.();
      onClose();
    } catch (err) {
      warning();
      Alert.alert('Не получилось', toApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }, [pickupPointId, dropoffPointId, weight, description, onCreated, onClose]);

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <View style={{ gap: spacing.md, padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="car-outline" size={24} color="primary" />
          <View style={{ flex: 1 }}>
            <Text variant="title">Заказать доставку</Text>
            <Text variant="caption" color="secondary">
              Попутчик подвезёт от линии продавца к вашей точке
            </Text>
          </View>
        </View>

        {error ? (
          <Card>
            <Text variant="caption" color="onWarning">
              Точки не загрузились: {error}
            </Text>
          </Card>
        ) : null}

        {/* Откуда: линии продавцов рядом. */}
        <View style={{ gap: spacing.sm }}>
          <Text variant="body" weight="600">
            Откуда забрать
          </Text>
          {loading ? (
            <Text variant="caption" color="secondary">
              Ищем линии продавцов рядом…
            </Text>
          ) : pickupOptions.length === 0 ? (
            <Text variant="caption" color="secondary">
              Рядом нет опубликованных линий продавцов (в {NEARBY_RADIUS_M / 1000} км).
            </Text>
          ) : (
            pickupOptions.slice(0, 6).map((point) => (
              <OptionRow
                key={point.id}
                selected={pickupPointId === point.id}
                title={point.label ?? point.address ?? GEO_POINT_KIND_LABELS[point.kind]}
                subtitle={point.distanceMeters !== undefined ? `${point.distanceMeters} м от вас` : undefined}
                onPress={() => {
                  tap();
                  setPickupPointId(point.id);
                }}
              />
            ))
          )}
        </View>

        {/* Куда: мои точки. */}
        <View style={{ gap: spacing.sm }}>
          <Text variant="body" weight="600">
            Куда привезти
          </Text>
          {dropoffOptions.length === 0 ? (
            <Text variant="caption" color="secondary">
              Сначала отметьте «Моя точка» на ленте — куда везти.
            </Text>
          ) : (
            dropoffOptions.slice(0, 4).map((point) => (
              <OptionRow
                key={point.id}
                selected={dropoffPointId === point.id}
                title={point.label ?? point.address ?? 'Моя точка'}
                subtitle={point.address ?? undefined}
                onPress={() => {
                  tap();
                  setDropoffPointId(point.id);
                }}
              />
            ))
          )}
        </View>

        <ShakeField shakeKey={weightShake}>
          <Input
            placeholder="Вес, кг (например 250.5)"
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            error={weight.length > 0 && !weightValid ? 'От 1 кг до 20 000 кг — вместимость «Газели»' : null}
          />
        </ShakeField>
        <Input
          placeholder="Что везём (опционально)"
          value={description}
          onChangeText={setDescription}
          autoCapitalize="sentences"
        />

        <Button
          title="Создать запрос"
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onPress={() => void handleSubmit()}
        />
        <Text variant="caption" color="muted" align="center">
          Цену называет водитель при контакте: платформа не показывает
          стоимость и не участвует в расчётах.
        </Text>
      </View>
    </SheetModal>
  );
}

/** Строка-вариант точки. */
function OptionRow({
  selected,
  title,
  subtitle,
  onPress,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? '#2E6B4E' : '#D8D2C6',
        backgroundColor: selected ? '#E7F0E9' : 'transparent',
      }}
    >
      <Icon
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={20}
        color={selected ? 'primary' : 'secondary'}
      />
      <View style={{ flex: 1 }}>
        <Text variant="body" color={selected ? 'primary' : 'secondary'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
