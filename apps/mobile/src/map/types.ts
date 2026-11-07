/**
 * Общие типы картографического слоя (v0.5.0, ADR-014).
 *
 * Платформенно-разделённая реализация: native — react-native-maps
 * (Expo Go), web — Leaflet + OpenStreetMap (v0.6.0-D, ADR-034).
 * Контракт один — MapCanvas.
 *
 * v0.6.2-D (ADR-030): цвета карты — обязательный проп из mapPalette[mode]
 * (токены дизайн-системы). hardcoded-хексы ушли: карта теперь следует
 * теме, в тёмной — тёмная канва и осветлённые маркеры (аудит №5/№6).
 */
import type { MapThemeColors, ThemeMode } from '@agromoll/ui';
import type { GeoCoord, GeoPointKind } from '@agromoll/types';

/** Маркер на карте: точка покупателя / линия продавца / коридор. */
export interface MapMarker {
  id: string;
  coord: GeoCoord;
  kind: GeoPointKind;
  label?: string;
}

/** Линия маршрута доставщика (коридор, ADR-014). */
export interface MapLine {
  id: string;
  from: GeoCoord;
  to: GeoCoord;
  label?: string;
}

/** Контракт платформенной карты (native + web). */
export interface MapCanvasProps {
  center: GeoCoord;
  markers: MapMarker[];
  lines?: MapLine[];
  /** Перетаскиваемый пин «моя точка» (подтверждение выбора). */
  pin?: GeoCoord | null;
  onPinChange?: (coord: GeoCoord) => void;
  /** Тап по свободному месту карты. */
  onTap?: (coord: GeoCoord) => void;
  height?: number;
  /** Цвета карты из темы: mapPalette[mode] — обязательны (v0.6.2-D, ADR-030). */
  colors: MapThemeColors;
  /** Режим темы: native-карта переключает системные тайлы (iOS). */
  mode: ThemeMode;
}
