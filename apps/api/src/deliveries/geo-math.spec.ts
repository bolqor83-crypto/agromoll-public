/**
 * Unit-тесты гео-математики радара (v0.5.0, ADR-015).
 *
 * Точки — Ростов-на-Дону. 0.001° широты ≈ 111 м, 0.001° долготы
 * (на 47.2°) ≈ 75.5 м. Проверяем гаверсинус и расстояние до отрезка:
 * на линии, сбоку, до/после концов.
 */
import { haversineMeters, pointToSegmentMeters } from './geo-math';

const MARKET = { lat: 47.2224, lng: 39.7138 };
const NORTH_111M = { lat: 47.2234, lng: 39.7138 }; // +0.001°
const EAST_75M = { lat: 47.2224, lng: 39.7148 }; // +0.001°

describe('haversineMeters', () => {
  it('0.001° широты ≈ 111 м', () => {
    const d = haversineMeters(MARKET, NORTH_111M);
    expect(d).toBeGreaterThanOrEqual(110);
    expect(d).toBeLessThanOrEqual(112);
  });

  it('0.001° долготы на 47.2° ≈ 75.5 м', () => {
    const d = haversineMeters(MARKET, EAST_75M);
    expect(d).toBeGreaterThanOrEqual(74);
    expect(d).toBeLessThanOrEqual(77);
  });

  it('симметрия и ноль', () => {
    expect(haversineMeters(MARKET, MARKET)).toBe(0);
    expect(haversineMeters(MARKET, NORTH_111M)).toBeCloseTo(
      haversineMeters(NORTH_111M, MARKET),
      6,
    );
  });
});

describe('pointToSegmentMeters', () => {
  // Отрезок: рынок → 1.1 км на восток.
  const B = { lat: 47.2224, lng: 39.7288 };

  it('точка на середине линии — расстояние ~0', () => {
    const mid = { lat: 47.2224, lng: 39.7213 };
    const d = pointToSegmentMeters(mid, MARKET, B);
    expect(d).toBeLessThan(5);
  });

  it('точка сбоку от середины — перпендикуляр ~широтный сдвиг', () => {
    // 0.005° широты ≈ 555 м к северу от середины линии.
    const beside = { lat: 47.2274, lng: 39.7213 };
    const d = pointToSegmentMeters(beside, MARKET, B);
    expect(d).toBeGreaterThanOrEqual(540);
    expect(d).toBeLessThanOrEqual(570);
  });

  it('точка «за» началом — расстояние до A', () => {
    // 0.003° западнее рынка: проекция за отрезком.
    const behind = { lat: 47.2224, lng: 39.7108 };
    const d = pointToSegmentMeters(behind, MARKET, B);
    // 0.003° долготы ≈ 226 м — это и есть ответ (не кросс-трек).
    expect(d).toBeGreaterThanOrEqual(215);
    expect(d).toBeLessThanOrEqual(240);
  });

  it('точка «после» конца — расстояние до B', () => {
    const beyond = { lat: 47.2224, lng: 39.7338 };
    const d = pointToSegmentMeters(beyond, MARKET, B);
    expect(d).toBeGreaterThanOrEqual(360);
    expect(d).toBeLessThanOrEqual(390);
  });

  it('вырожденный отрезок — просто гаверсинус', () => {
    const d = pointToSegmentMeters(NORTH_111M, MARKET, MARKET);
    expect(d).toBeGreaterThanOrEqual(110);
    expect(d).toBeLessThanOrEqual(112);
  });
});
