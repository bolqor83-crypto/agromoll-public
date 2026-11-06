/**
 * MyPointSheet — «Моя точка» (v0.5.0, подэтап B, ADR-014).
 *
 * Поток: геолокация (expo-location) → подтверждение на карте
 * (перетаскиваемый пин / тап) → адрес и название → сохранение.
 * Покупатель публикует buyer_point («куда везти»), продавец —
 * seller_line («мой ряд на рынке»). Гео-ошибки не блокируют:
 * точку можно выбрать тапом по карте от центра рынка.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import * as Location from 'expo-location';
import { Button, Card, Icon, Input, spacing, success, tap, Text, warning } from '@agromoll/ui';
import type { GeoCoord, UserRole } from '@agromoll/types';
import { MapCanvas } from '@/map';
import { api, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { SheetModal } from './SheetModal';

/** Центр по умолчанию: Центральный рынок Ростова-на-Дону. */
export const MARKET_CENTER: GeoCoord = { lat: 47.2224, lng: 39.7138 };

export interface MyPointSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Роль определяет вид геозоны: buyer_point / seller_line. */
  role: UserRole;
  /** Точка сохранена — родитель может обновить свои данные. */
  onSaved?: () => void;
}

export function MyPointSheet({ visible, onClose, role, onSaved }: MyPointSheetProps) {
  const [pin, setPin] = useState<GeoCoord>(MARKET_CENTER);
  const [center, setCenter] = useState<GeoCoord>(MARKET_CENTER);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const kind = role === 'seller' ? 'seller_line' : 'buyer_point';
  const kindLabel = role === 'seller' ? 'Мой ряд на рынке' : 'Точка получения';

  // При открытии — попытка геолокации (мягкая: отказ не блокирует).
  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    setLocating(true);
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          logger.info('geo', 'разрешение геолокации не выдано — центр рынка');
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) {
          return;
        }
        const coord = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setPin(coord);
        setCenter(coord);
      } catch (error) {
        logger.warn('geo', 'геолокация не удалась', { error: String(error) });
      } finally {
        if (!cancelled) {
          setLocating(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      await api.createGeoPoint({
        kind,
        latitude: Number(pin.lat.toFixed(6)),
        longitude: Number(pin.lng.toFixed(6)),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      success();
      onSaved?.();
      onClose();
    } catch (error) {
      warning();
      Alert.alert('Не получилось', toApiError(error).message);
    } finally {
      setSaving(false);
    }
  }, [kind, pin, address, label, onSaved, onClose]);

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <View style={{ gap: spacing.md, padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="location-outline" size={24} color="primary" />
          <View style={{ flex: 1 }}>
            <Text variant="title">Моя точка</Text>
            <Text variant="caption" color="secondary">
              {kindLabel} · перетащите пин или тапните по карте
            </Text>
          </View>
        </View>

        <MapCanvas
          center={center}
          markers={[]}
          pin={pin}
          onPinChange={setPin}
          onTap={setPin}
          height={260}
        />

        <Card style={{ gap: spacing.sm }}>
          <View style={{ gap: spacing.xs }}>
            <Text variant="caption" color="secondary">
              Координаты: {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              {locating ? ' · определяем…' : ''}
            </Text>
          </View>
          <Input
            placeholder="Адрес (ул. Станиславского, 8)"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="sentences"
          />
          <Input
            placeholder="Название («Мой ларёк», «Ряд 12»)"
            value={label}
            onChangeText={setLabel}
            autoCapitalize="sentences"
          />
        </Card>

        <Button
          title="Сохранить точку"
          size="lg"
          onPress={() => void handleSave()}
          loading={saving}
        />
        <Text variant="caption" color="muted" align="center">
          Точка видна рынку: по ней работает фильтр «Рядом» и доставка.
        </Text>
      </View>
    </SheetModal>
  );
}
