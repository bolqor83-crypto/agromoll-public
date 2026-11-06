/**
 * Общие типы картографического слоя (v0.5.0, ADR-014).
 *
 * Платформенно-разделённая реализация: native — react-native-maps
 * (Expo Go), web — схематичная SVG-карта (без тайловых зависимостей,
 * см. ADR-014). Контракт один — MapCanvas.
 */
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

/** Цвета маркеров по виду геозоны: синий/зелёный/янтарный (спецификация). */
export const MARKER_COLORS: Record<GeoPointKind, string> = {
  buyer_point: '#3B6FA0', // спокойный синий — точка покупателя
  seller_line: '#2E6B4E', // фирменный зелёный — линия продавца
  delivery_corridor: '#C98A2D', // мягкий янтарный — коридор доставщика
};

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
}
