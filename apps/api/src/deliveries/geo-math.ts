/**
 * Сферическая геометрия для радара доставщика (v0.5.0, ADR-015).
 *
 * Расстояние «точка → отрезок маршрута» по формуле cross-track:
 * это и есть «насколько заказ попутный». Чистые функции — тестируются
 * unit-ами без БД.
 */
import type { GeoCoord } from '@agromoll/types';

/** Радиус Земли, м (средний — точности рынка более чем достаточно). */
const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Нормализация угла в [−π, π]. */
function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) {
    a -= 2 * Math.PI;
  }
  while (a < -Math.PI) {
    a += 2 * Math.PI;
  }
  return a;
}

/** Расстояние между двумя точками (формула гаверсинуса), метры. */
export function haversineMeters(a: GeoCoord, b: GeoCoord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Начальный азимут a → b, радианы. */
export function bearingRad(a: GeoCoord, b: GeoCoord): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const deltaLng = toRad(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng);
  return Math.atan2(y, x);
}

/**
 * Расстояние от точки P до отрезка A→B по дуге большого круга, метры.
 * Если проекция падает вне отрезка (P «за» A или «после» B) —
 * расстояние до ближайшего конца.
 */
export function pointToSegmentMeters(p: GeoCoord, a: GeoCoord, b: GeoCoord): number {
  if (haversineMeters(a, b) === 0) {
    return haversineMeters(p, a); // вырожденный отрезок — точка
  }

  const thetaAB = bearingRad(a, b);
  const thetaAP = bearingRad(a, p);
  // P «позади» A: направление на P отклоняется от линии больше чем на 90°.
  if (Math.abs(normalizeAngle(thetaAP - thetaAB)) > Math.PI / 2) {
    return haversineMeters(p, a);
  }

  const thetaBA = bearingRad(b, a);
  const thetaBP = bearingRad(b, p);
  // P «дальше» B.
  if (Math.abs(normalizeAngle(thetaBP - thetaBA)) > Math.PI / 2) {
    return haversineMeters(p, b);
  }

  // Проекция внутри отрезка: cross-track расстояние.
  const dAP = haversineMeters(a, p);
  const sinRatio = Math.sin(dAP / EARTH_RADIUS_M) * Math.sin(thetaAP - thetaAB);
  return Math.abs(Math.asin(Math.min(1, Math.max(-1, sinRatio))) * EARTH_RADIUS_M);
}
