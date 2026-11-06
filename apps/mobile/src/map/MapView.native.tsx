/**
 * Карта для native (iOS/Android) — react-native-maps (v0.5.0, ADR-014).
 *
 * Библиотека входит в Expo Go — предbuild не нужен. Маркеры окрашены
 * из палитры темы (mapPalette[mode], v0.6.2-D), коридоры — линиями
 * маршрута. В тёмной теме iOS переключает системные тайлы карты
 * (userInterfaceStyle) — карта не «выбивается» светлым пятном.
 */
import { useMemo } from 'react';
import { Platform } from 'react-native';
import MapViewImpl, { Marker, Polyline } from 'react-native-maps';
import { markerColorFor } from '@agromoll/ui';
import type { MapCanvasProps, MapLine, MapMarker } from './types';

/** Событие тапа по карте с координатой (подмножество типов react-native-maps). */
interface MapTapEvent {
  nativeEvent: { coordinate: { latitude: number; longitude: number } };
}

/** Перевод координаты события карты в GeoCoord. */
function toCoord(event: MapTapEvent): { lat: number; lng: number } {
  const { latitude, longitude } = event.nativeEvent.coordinate;
  return { lat: latitude, lng: longitude };
}

export default function MapCanvas({
  center,
  markers,
  lines = [],
  pin = null,
  onPinChange,
  onTap,
  height = 300,
  colors,
  mode,
}: MapCanvasProps) {
  const region = useMemo(
    () => ({
      latitude: center.lat,
      longitude: center.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }),
    [center.lat, center.lng],
  );

  const renderMarker = (marker: MapMarker): JSX.Element => (
    <Marker
      key={marker.id}
      coordinate={{ latitude: marker.coord.lat, longitude: marker.coord.lng }}
      title={marker.label ?? marker.kind}
      pinColor={markerColorFor(marker.kind, colors)}
    />
  );

  const renderLine = (line: MapLine): JSX.Element => (
    <Polyline
      key={`line-${line.id}`}
      coordinates={[
        { latitude: line.from.lat, longitude: line.from.lng },
        { latitude: line.to.lat, longitude: line.to.lng },
      ]}
      strokeColor={colors.corridor}
      strokeWidth={3}
    />
  );

  /** Тап по карте: приводим событие библиотеки к нашему контракту. */
  const handlePress = (event: unknown): void => {
    const native = (event as MapTapEvent).nativeEvent;
    onTap?.({
      lat: native.coordinate.latitude,
      lng: native.coordinate.longitude,
    });
  };

  return (
    <MapViewImpl
      style={{ height, borderRadius: 16 }}
      initialRegion={region}
      region={region}
      onPress={handlePress}
      // v0.6.2-D (ADR-030): тёмная тема — тёмные системные тайлы на iOS 13+.
      // Пробрасываем только на iOS: на Android этот проп игнорируется
      // (стилизация Google-тайлов — customMapStyle, отдельной задачей за
      // пределами этапа: требует визуальной проверки на устройстве).
      userInterfaceStyle={Platform.OS === 'ios' ? mode : undefined}
    >
      {markers.map(renderMarker)}
      {lines.map(renderLine)}
      {pin ? (
        <Marker
          draggable
          coordinate={{ latitude: pin.lat, longitude: pin.lng }}
          title="Моя точка"
          pinColor={colors.sellerLine}
          onDragEnd={(event: unknown) => onPinChange?.(toCoord(event as MapTapEvent))}
        />
      ) : null}
    </MapViewImpl>
  );
}
