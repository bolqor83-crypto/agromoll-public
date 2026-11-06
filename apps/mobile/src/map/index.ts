/**
 * Картографический слой (v0.5.0, ADR-014).
 *
 * Metro сам выбирает платформенную реализацию: .native.tsx —
 * react-native-maps (iOS/Android, входит в Expo Go), .web.tsx —
 * схематичная SVG-карта. Импорт 'react-native-maps' живёт ТОЛЬКО в
 * .native-файле — web-сборка его не видит (экспорт на Vercel, D).
 *
 * v0.6.2-D: цвета карты — mapPalette из '@agromoll/ui' (ADR-030);
 * MARKER_COLORS с hardcoded-хексами удалён (аудит №5).
 */
export { default as MapCanvas } from './MapView';
export type { MapCanvasProps, MapLine, MapMarker } from './types';
