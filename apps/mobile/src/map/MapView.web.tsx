/**
 * Карта для web — схематичная SVG-карта (v0.5.0, ADR-014).
 *
 * Почему не Leaflet/react-native-web-maps на web: тайловые библиотеки
 * тянут DOM-зависимости, конфликтующие с expo export, и требуют
 * провайдера тайлов (ключ/лицензия) ради MVP-задачи «показать точки
 * рядом». Схема с относительными координатами решает задачу без
 * новых зависимостей и не ломает web-сборку (подэтап D).
 *
 * Взаимодействие: клик по полю — выбор координаты (onTap), пин можно
 * «перетащить» повторным кликом (onPinChange при выставленном pin).
 */
import { useMemo, useRef } from 'react';
import { View } from 'react-native';
import type { NativeSyntheticEvent, View as RNView } from 'react-native';
import { markerColorFor } from '@agromoll/ui';
import type { GeoCoord } from '@agromoll/types';
import type { MapCanvasProps } from './types';

/** Полуразмах окна карты в градусах (~2.2 км по широте). */
const SPAN = 0.01;

/** Указатель web-события: offsetX/Y относительно цели (DOM PointerEvent). */
interface WebPointerEvent {
  offsetX?: number;
  offsetY?: number;
}

/** Проекция lat/lng → проценты внутри канвы (y инвертирован). */
function project(center: GeoCoord, coord: GeoCoord): { x: number; y: number } {
  const x = 50 + ((coord.lng - center.lng) / (SPAN * 2)) * 100;
  const y = 50 - ((coord.lat - center.lat) / (SPAN * 2)) * 100;
  // кламп в границы канвы
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

/** Обратная проекция процентов → lat/lng. */
function unproject(center: GeoCoord, x: number, y: number): GeoCoord {
  return {
    lat: center.lat + ((50 - y) / 100) * SPAN * 2,
    lng: center.lng + ((x - 50) / 100) * SPAN * 2,
  };
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
}: MapCanvasProps) {
  const canvasRef = useRef<RNView>(null);
  const centerProj = useMemo(() => project(center, center), [center]);

  /** Клик по канве → координата: пин двигается, иначе onTap. */
  const handlePointerDown = (
    event: NativeSyntheticEvent<WebPointerEvent>,
  ): void => {
    const ne = event.nativeEvent;
    if (ne.offsetX === undefined || ne.offsetY === undefined) {
      return;
    }
    const node = canvasRef.current as unknown as
      | { clientWidth?: number; clientHeight?: number }
      | null;
    const width = Math.max(1, node?.clientWidth ?? 0);
    const heightPx = Math.max(1, node?.clientHeight ?? 0);
    const x = (ne.offsetX / width) * 100;
    const y = (ne.offsetY / heightPx) * 100;
    const coord = unproject(center, x, y);
    if (pin && onPinChange) {
      onPinChange(coord);
    } else {
      onTap?.(coord);
    }
  };

  return (
    <View
      ref={canvasRef}
      accessibilityLabel="Карта рынка"
      accessible
      style={{
        height,
        borderRadius: 16,
        overflow: 'hidden',
        // v0.6.2-D: канва из темы — тёмная карта в тёмной теме (аудит №6)
        backgroundColor: colors.canvas,
      }}
      onPointerDown={handlePointerDown}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* Сетка ориентира: крупные улицы рынка, без тайлов (ADR-014). */}
        {[25, 50, 75].map((v) => (
          <g key={v}>
            <line x1={v} y1={0} x2={v} y2={100} stroke={colors.grid} strokeWidth={0.4} />
            <line x1={0} y1={v} x2={100} y2={v} stroke={colors.grid} strokeWidth={0.4} />
          </g>
        ))}

        {/* Коридоры — янтарные линии маршрутов. */}
        {lines.map((line) => {
          const from = project(center, line.from);
          const to = project(center, line.to);
          return (
            <line
              key={`line-${line.id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={colors.corridor}
              strokeWidth={0.9}
              strokeLinecap="round"
            />
          );
        })}

        {/* Точки: покупатели синие, продавцы зелёные, коридоры янтарные. */}
        {markers.map((marker) => {
          const p = project(center, marker.coord);
          return (
            <circle
              key={marker.id}
              cx={p.x}
              cy={p.y}
              r={1.8}
              fill={markerColorFor(marker.kind, colors)}
              fillOpacity={0.9}
            />
          );
        })}

        {/* Центр (позиция пользователя) — кольцо из темы. */}
        <circle
          cx={centerProj.x}
          cy={centerProj.y}
          r={1.2}
          fill="none"
          stroke={colors.centerRing}
          strokeWidth={0.5}
        />

        {/* Пин «моя точка» — зелёная капля. */}
        {pin
          ? (() => {
              const p = project(center, pin);
              return (
                <g>
                  <circle cx={p.x} cy={p.y} r={2.4} fill={colors.sellerLine} />
                  <circle cx={p.x} cy={p.y} r={0.9} fill={colors.pinHole} />
                </g>
              );
            })()
          : null}
      </svg>
    </View>
  );
}
