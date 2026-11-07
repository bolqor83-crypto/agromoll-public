/**
 * Картографический слой (v0.5.0, ADR-014; web — v0.6.0-D, ADR-034).
 *
 * Metro сам выбирает платформенную реализацию: .native.tsx —
 * react-native-maps (iOS/Android, входит в Expo Go), .web.tsx —
 * Leaflet + тайлы OpenStreetMap с кластеризацией точек (плиточная
 * карта взамен схематичной SVG). Импорт 'react-native-maps' живёт
 * ТОЛЬКО в .native-файле, Leaflet грузится динамически только в web —
 * сборки платформ чужих зависимостей не видят (экспорт на Vercel, D).
 *
 * v0.6.2-D: цвета карты — mapPalette из '@agromoll/ui' (ADR-030);
 * MARKER_COLORS с hardcoded-хексами удалён (аудит №5).
 */
export { default as MapCanvas } from './MapView';
export type { MapCanvasProps, MapLine, MapMarker } from './types';
