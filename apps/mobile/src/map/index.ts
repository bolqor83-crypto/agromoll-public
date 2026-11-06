/**
 * Картографический слой (v0.5.0, ADR-014).
 *
 * Metro сам выбирает платформенную реализацию: .native.tsx —
 * react-native-maps (iOS/Android, входит в Expo Go), .web.tsx —
 * схематичная SVG-карта. Импорт 'react-native-maps' живёт ТОЛЬКО в
 * .native-файле — web-сборка его не видит (экспорт на Vercel, D).
 */
export { default as MapCanvas } from './MapView';
export { MARKER_COLORS } from './types';
export type { MapCanvasProps, MapLine, MapMarker } from './types';
