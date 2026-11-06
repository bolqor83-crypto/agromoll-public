/**
 * Карта для native (iOS/Android) — react-native-maps (v0.5.0, ADR-014).
 *
 * Библиотека входит в Expo Go — предbuild не нужен. Маркеры окрашены
 * по виду геозоны (спецификация B), коридоры — линиями маршрута.
 */
import { useMemo } from 'react';
import MapViewImpl, { Marker, Polyline } from 'react-native-maps';
import { MARKER_COLORS } from './types';
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
      pinColor={MARKER_COLORS[marker.kind]}
    />
  );

  const renderLine = (line: MapLine): JSX.Element => (
    <Polyline
      key={`line-${line.id}`}
      coordinates={[
        { latitude: line.from.lat, longitude: line.from.lng },
        { latitude: line.to.lat, longitude: line.to.lng },
      ]}
      strokeColor={MARKER_COLORS.delivery_corridor}
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
    >
      {markers.map(renderMarker)}
      {lines.map(renderLine)}
      {pin ? (
        <Marker
          draggable
          coordinate={{ latitude: pin.lat, longitude: pin.lng }}
          title="Моя точка"
          pinColor="#2E6B4E"
          onDragEnd={(event: unknown) => onPinChange?.(toCoord(event as MapTapEvent))}
        />
      ) : null}
    </MapViewImpl>
  );
}
