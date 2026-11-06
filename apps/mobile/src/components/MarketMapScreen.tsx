/**
 * MarketMapScreen — «Карта рынка» (v0.5.0, подэтап B, ADR-014).
 *
 * Показывает геозоны вокруг пользователя (или центра рынка):
 * точки покупателей — синие, линии продавцов — зелёные, коридоры
 * доставщиков — янтарные линии. Водитель может опубликовать маршрут
 * («кто едет куда» — фундамент подэтапа C).
 *
 * Карта платформенно-разделённая: native — react-native-maps,
 * web — схематичная SVG (ADR-014).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Icon,
  PullToRefreshScrollView,
  Screen,
  Skeleton,
  spacing,
  success,
  tap,
  Text,
  mapPalette,
  useTheme,
  warning,
} from '@agromoll/ui';
import type { GeoCoord, GeoPointDto, GeoVehicleType } from '@agromoll/types';
import { GEO_POINT_KIND_LABELS, GEO_VEHICLE_LABELS } from '@agromoll/types';
import { MapCanvas } from '@/map';
import type { MapLine, MapMarker } from '@/map';
import { ScreenHeader } from '@/components/ScreenHeader';
import { MyPointSheet, MARKET_CENTER } from '@/components/MyPointSheet';
import { useAuthStore } from '@/store/auth';
import { api, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';

/** Радиус обзора карты по умолчанию (ENV-двойник сервера, ADR-014). */
const NEARBY_RADIUS_M = 2000;

/** Режимы экрана: просмотр / создание маршрута (два тапа). */
type Mode = 'view' | 'awaiting-from' | 'awaiting-to';

/** Выбор типа транспорта при публикации маршрута. */
const VEHICLE_OPTIONS: GeoVehicleType[] = ['car', 'van', 'refrigerated', 'flatbed'];

export function MarketMapScreen() {
  const role = useAuthStore((s) => s.user?.role ?? 'buyer');
  // v0.6.2-D: карта следует теме — маркеры/канва из mapPalette, чипы
  // выбора ТС и легенда — из тех же токенов (аудит №5/№6, ADR-030).
  // themeMode, не mode: mode здесь — стейт «задать маршрут» (view/awaiting-*)
  const { mode: themeMode, colors: themeColors } = useTheme();
  const mapColors = mapPalette[themeMode];
  const [center, setCenter] = useState<GeoCoord>(MARKET_CENTER);
  const [points, setPoints] = useState<GeoPointDto[]>([]);
  const [corridors, setCorridors] = useState<GeoPointDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointSheetOpen, setPointSheetOpen] = useState(false);

  // Публикация маршрута водителем: старт → финиш → параметры.
  const [mode, setMode] = useState<Mode>('view');
  const [from, setFrom] = useState<GeoCoord | null>(null);
  const [to, setTo] = useState<GeoCoord | null>(null);
  const [vehicleType, setVehicleType] = useState<GeoVehicleType>('van');
  const [maxWeight, setMaxWeight] = useState('');
  const [isRefrigerated, setRefrigerated] = useState(false);
  const [publishing, setPublishing] = useState(false);

  /** Загрузка геозон вокруг центра. */
  const load = useCallback(async (): Promise<void> => {
    try {
      const [pts, corr] = await Promise.all([
        api.geoPointsNearby({ lat: center.lat, lng: center.lng, radiusMeters: NEARBY_RADIUS_M }),
        api.geoCorridorsNearby({ lat: center.lat, lng: center.lng, radiusMeters: NEARBY_RADIUS_M }),
      ]);
      setPoints(pts);
      setCorridors(corr);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
      logger.warn('map', 'геозоны не загрузились', { error: toApiError(err).message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [center.lat, center.lng]);

  // Геолокация при первом входе → затем загрузка.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // v0.6.1-A: динамический импорт — иначе Metro тащит expo-location в entry (ADR-023).
        const { default: Location } = await import('expo-location');
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCenter({ lat: position.coords.latitude, lng: position.coords.longitude });
        }
      } catch (err) {
        logger.info('map', 'геолокация недоступна — центр рынка', { error: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load();
  }, [load]);

  /** Маркеры: точки покупателей + линии продавцов (+ коридоры точками). */
  const markers = useMemo<MapMarker[]>(
    () =>
      points.map((point) => ({
        id: point.id,
        coord: { lat: point.latitude, lng: point.longitude },
        kind: point.kind,
        label: point.label ?? GEO_POINT_KIND_LABELS[point.kind],
      })),
    [points],
  );

  /** Линии маршрутов доставщиков. */
  const lines = useMemo<MapLine[]>(
    () =>
      corridors
        .filter((c) => c.corridorFrom && c.corridorTo)
        .map((c) => ({
          id: c.id,
          from: c.corridorFrom!,
          to: c.corridorTo!,
          label: c.label ?? 'Маршрут доставщика',
        })),
    [corridors],
  );

  /** Тап по карте в режиме маршрута. */
  const handleTap = useCallback(
    (coord: GeoCoord): void => {
      if (mode === 'awaiting-from') {
        setFrom(coord);
        setMode('awaiting-to');
      } else if (mode === 'awaiting-to') {
        setTo(coord);
      }
    },
    [mode],
  );

  /** Публикация маршрута (только driver). */
  const publishCorridor = useCallback(async (): Promise<void> => {
    if (!from || !to) {
      return;
    }
    setPublishing(true);
    try {
      await api.createGeoCorridor({
        corridorFrom: { lat: Number(from.lat.toFixed(6)), lng: Number(from.lng.toFixed(6)) },
        corridorTo: { lat: Number(to.lat.toFixed(6)), lng: Number(to.lng.toFixed(6)) },
        vehicleType,
        ...(maxWeight.trim() ? { maxWeightKg: Number(maxWeight.trim()) } : {}),
        isRefrigerated,
      });
      success();
      setMode('view');
      setFrom(null);
      setTo(null);
      setMaxWeight('');
      setRefrigerated(false);
      await load();
    } catch (err) {
      warning();
      Alert.alert('Не получилось', toApiError(err).message);
    } finally {
      setPublishing(false);
    }
  }, [from, to, vehicleType, maxWeight, isRefrigerated, load]);

  const modeHint =
    mode === 'awaiting-from'
      ? 'Тапните по карте — точка СТАРТА маршрута'
      : mode === 'awaiting-to'
        ? 'Тапните по карте — точку ФИНИША'
        : null;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Карта рынка"
        subtitle="Точки покупателей · линии продавцов · маршруты"
        badge={<Badge label={`В радиусе ${NEARBY_RADIUS_M / 1000} км`} variant="neutral" />}
      />

      {loading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={280} />
          <Skeleton height={72} />
        </View>
      ) : (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={handleRefresh} style={{ flex: 1 }}>
          <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
            <View>
              <MapCanvas
                center={center}
                markers={markers}
                lines={lines}
                pin={from}
                onPinChange={setFrom}
                onTap={handleTap}
                height={300}
                colors={mapColors}
                mode={themeMode}
              />
              {modeHint ? (
                <Card style={{ marginTop: spacing.sm, padding: spacing.sm }}>
                  <Text variant="body" color="primary" weight="600">
                    {modeHint}
                  </Text>
                </Card>
              ) : null}
            </View>

            {error ? (
              <Card>
                <Text variant="body" color="onWarning">
                  Геозоны не загрузились: {error}
                </Text>
              </Card>
            ) : null}

            {/* Легенда — семантические роли из mapPalette (v0.6.2-D, ADR-030). */}
            <Card style={{ gap: spacing.sm }}>
              <Text variant="body" weight="600">
                Обозначения
              </Text>
              <LegendRow color={mapColors.buyerPoint} label="Точки покупателей — куда везти" />
              <LegendRow color={mapColors.sellerLine} label="Линии продавцов — ряды рынка" />
              <LegendRow color={mapColors.corridor} label="Маршруты доставщиков — «еду туда»" />
            </Card>

            {/* Свои геозоны. */}
            {role !== 'driver' ? (
              <Button
                title="Моя точка"
                variant="secondary"
                size="md"
                onPress={() => {
                  tap();
                  setPointSheetOpen(true);
                }}
              />
            ) : (
              <Card style={{ gap: spacing.sm }}>
                <Text variant="body" weight="600">
                  Мой маршрут
                </Text>
                {mode === 'view' ? (
                  <>
                    <Text variant="caption" color="secondary">
                      «Еду из А в Б — могу подвезти». Маршрут увидят покупатели рядом с вашей
                      дорогой.
                    </Text>
                    <Button
                      title="Задать маршрут"
                      size="md"
                      onPress={() => {
                        tap();
                        setFrom(null);
                        setTo(null);
                        setMode('awaiting-from');
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Text variant="caption" color="secondary">
                      Старт: {from ? `${from.lat.toFixed(4)}, ${from.lng.toFixed(4)}` : '—'}
                      {'\n'}Финиш: {to ? `${to.lat.toFixed(4)}, ${to.lng.toFixed(4)}` : '—'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {VEHICLE_OPTIONS.map((option) => (
                        <Pressable
                          key={option}
                          accessibilityRole="button"
                          onPress={() => {
                            tap();
                            setVehicleType(option);
                          }}
                          style={{
                            paddingHorizontal: spacing.md,
                            paddingVertical: spacing.xs,
                            borderRadius: 12,
                            borderWidth: 1,
                            // v0.6.2-D: чипы выбора ТС — из токенов темы,
                            // в тёмной больше не светятся «бумажным» цветом
                            borderColor:
                              vehicleType === option ? themeColors.primary : themeColors.border,
                            backgroundColor:
                              vehicleType === option ? themeColors.primaryMuted : 'transparent',
                          }}
                        >
                          <Text
                            variant="caption"
                            color={vehicleType === option ? 'primary' : 'secondary'}
                          >
                            {GEO_VEHICLE_LABELS[option]}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      accessibilityRole="checkbox"
                      onPress={() => {
                        tap();
                        setRefrigerated((v) => !v);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                    >
                      <Icon
                        name={isRefrigerated ? 'checkbox-outline' : 'square-outline'}
                        size={20}
                        color={isRefrigerated ? 'primary' : 'secondary'}
                      />
                      <Text variant="body" color="secondary">
                        Рефрижератор (холодовой груз)
                      </Text>
                    </Pressable>
                    <Button
                      title="Опубликовать маршрут"
                      size="md"
                      disabled={!from || !to}
                      loading={publishing}
                      onPress={() => void publishCorridor()}
                    />
                    <Button
                      title="Отмена"
                      variant="ghost"
                      size="md"
                      onPress={() => {
                        tap();
                        setMode('view');
                        setFrom(null);
                        setTo(null);
                      }}
                    />
                  </>
                )}
              </Card>
            )}

            {/* Маршруты рядом — лента «кто едет куда» (фундамент C). */}
            {corridors.length > 0 ? (
              <Card style={{ gap: spacing.sm }}>
                <Text variant="body" weight="600">
                  Кто едет рядом
                </Text>
                {corridors.slice(0, 5).map((corridor) => (
                  <View key={corridor.id} style={{ gap: 2 }}>
                    <Text variant="body">
                      {GEO_VEHICLE_LABELS[corridor.vehicleType]}
                      {corridor.isRefrigerated ? ' · рефрижератор' : ''}
                      {corridor.maxWeightKg ? ` · до ${corridor.maxWeightKg} кг` : ''}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {corridor.distanceMeters !== undefined
                        ? `в ${corridor.distanceMeters} м от вас`
                        : 'рядом с вами'}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}
          </View>
        </PullToRefreshScrollView>
      )}

      <MyPointSheet
        visible={pointSheetOpen}
        onClose={() => setPointSheetOpen(false)}
        role={role}
        onSaved={() => void load()}
      />
    </Screen>
  );
}

/** Строка легенды: цветной кружок + подпись. */
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: color,
        }}
      />
      <Text variant="caption" color="secondary">
        {label}
      </Text>
    </View>
  );
}
