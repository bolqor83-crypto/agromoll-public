/**
 * Карта для web — Leaflet + OpenStreetMap (v0.6.0-D, ADR-034).
 *
 * Заменяет схематичную SVG-карту (v0.5.0): настоящие тайлы, зум,
 * панорамирование, кластеризация точек рынка. Контракт MapCanvasProps
 * тот же — MarketMapScreen и MyPointSheet платформы не знают.
 *
 * Leaflet грузится ДИНАМИЧЕСКИ в useEffect (ADR-023: тяжёлая
 * зависимость только в момент показа карты; static export не выполняет
 * её при пререндере — Leaflet трогает window на импорте). CSS —
 * минимальная инъекция из leaflet-helpers: полный leaflet.css тянет
 * url()-ассеты дефолтных маркеров и Metro-CSS-пайплайн (ADR-034).
 *
 * OSM fair use: атрибуция обязательна, zoom 12–19, тайлы стандартного
 * стиля tile.openstreetmap.org — для MVP-нагрузки рынка допустимо
 * (политика тайлов OSM: умеренное использование с атрибуцией; при
 * росте — свой стиль/провайдер, см. ADR-034).
 */
import { useEffect, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
import { markerColorFor } from '@agromoll/ui';
import type { MapThemeColors } from '@agromoll/ui';
import type { GeoCoord } from '@agromoll/types';
import type { MapCanvasProps } from './types';
import {
  MY_PIN_SIZE,
  PIN_SIZE,
  clusterHtml,
  centerRingHtml,
  containerClassFor,
  injectLeafletStyles,
  markerHtml,
  myPinHtml,
} from './leaflet-helpers';

/** URL тайлов OSM (без ключей, fair use, ADR-034). */
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Стартовый зум: рынок виден целиком, ряды различимы. */
const DEFAULT_ZOOM = 16;

/** Тип динамически импортированного Leaflet-модуля. */
type LeafletModule = typeof LeafletNS;

/** Слои карты (пересобираются по props, вне React-стейта). */
interface MapLayers {
  map: LeafletNS.Map;
  cluster: LeafletNS.MarkerClusterGroup;
  lines: LeafletNS.LayerGroup;
  centerRing: LeafletNS.Marker | null;
  pin: LeafletNS.Marker | null;
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
  const divRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const layersRef = useRef<MapLayers | null>(null);
  // Свежие колбэки/палитра для императивных обработчиков Leaflet:
  // карту пересоздавать не надо — ref-ы читают актуальные значения.
  const interactRef = useRef({ onPinChange, onTap, hasPin: pin !== null });
  interactRef.current = { onPinChange, onTap, hasPin: pin !== null };
  const colorsRef = useRef<MapThemeColors>(colors);
  colorsRef.current = colors;

  // Инкремент после инициализации Leaflet: слои достраиваются, когда
  // динамический импорт закончился (эффекты слоёв уже отработали впустую).
  const [mapEpoch, setMapEpoch] = useState(0);

  // ── Инициализация (однократно): динамический импорт Leaflet ──────────────

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      // Leaflet трогает window при импорте — только в браузере.
      const L = (await import('leaflet')).default as unknown as LeafletModule;
      await import('leaflet.markercluster');
      if (disposed || !divRef.current) {
        return;
      }
      injectLeafletStyles();

      const map = L.map(divRef.current, {
        center: [center.lat, center.lng],
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(OSM_TILE_URL, {
        attribution: OSM_ATTRIBUTION,
        maxZoom: 19,
        // OSM fair use (ADR-034): разумные границы детализации.
        minZoom: 12,
      }).addTo(map);

      const cluster = L.markerClusterGroup({
        maxClusterRadius: 40,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: (cl) =>
          L.divIcon({
            html: clusterHtml(cl.getChildCount(), colorsRef.current),
            className: 'marker-cluster',
            iconSize: [46, 46],
            iconAnchor: [23, 23],
          }),
      });
      map.addLayer(cluster);

      // Тап по полю: пин двигается, иначе — выбор координаты.
      map.on('click', (event: LeafletNS.LeafletMouseEvent) => {
        const coord: GeoCoord = { lat: event.latlng.lat, lng: event.latlng.lng };
        const { onPinChange: movePin, onTap: tap, hasPin } = interactRef.current;
        if (hasPin && movePin) {
          movePin(coord);
        } else {
          tap?.(coord);
        }
      });

      leafletRef.current = L;
      layersRef.current = { map, cluster, lines: L.layerGroup().addTo(map), centerRing: null, pin: null };
      setMapEpoch((epoch) => epoch + 1);

      cleanup = () => {
        map.remove();
        leafletRef.current = null;
        layersRef.current = null;
      };
    })().catch((error) => {
      // Карта — вспомогательный слой: падение инициализации не роняет экран.
      console.warn('agromoll:map', 'Leaflet не инициализировался', { error: String(error) });
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
    // Инициализация — один раз на монтирование; центр двигается ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Центр: проп меняется → setView (геолокация/перевыбор) ────────────────

  useEffect(() => {
    layersRef.current?.map.setView([center.lat, center.lng], DEFAULT_ZOOM, { animate: true });
  }, [center.lat, center.lng]);

  // ── Маркеры и линии: пересборка слоёв (MVP-объёмы — десятки точек) ───────

  useEffect(() => {
    const L = leafletRef.current;
    const layers = layersRef.current;
    if (!L || !layers) {
      return;
    }
    layers.cluster.clearLayers();
    for (const marker of markers) {
      layers.cluster.addLayer(
        L.marker([marker.coord.lat, marker.coord.lng], {
          icon: L.divIcon({
            html: markerHtml(markerColorFor(marker.kind, colors), colors, marker.label),
            className: '',
            iconSize: [PIN_SIZE, PIN_SIZE],
            iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
          }),
          title: marker.label ?? 'Точка рынка',
          keyboard: false,
        }),
      );
    }

    layers.lines.clearLayers();
    for (const line of lines) {
      L.polyline(
        [
          [line.from.lat, line.from.lng],
          [line.to.lat, line.to.lng],
        ],
        { color: colors.corridor, weight: 4, opacity: 0.85 },
      ).addTo(layers.lines);
    }
  }, [markers, lines, colors, mapEpoch]);

  // ── Кольцо позиции пользователя (центр) ──────────────────────────────────

  useEffect(() => {
    const L = leafletRef.current;
    const layers = layersRef.current;
    if (!L || !layers) {
      return;
    }
    layers.centerRing?.remove();
    layers.centerRing = L.marker([center.lat, center.lng], {
      icon: L.divIcon({
        html: centerRingHtml(colors),
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(layers.map);
  }, [center.lat, center.lng, colors, mapEpoch]);

  // ── Пин «моя точка»: перетаскивание + dragend → onPinChange ──────────────

  useEffect(() => {
    const L = leafletRef.current;
    const layers = layersRef.current;
    if (!L || !layers) {
      return;
    }
    if (!pin) {
      layers.pin?.remove();
      layers.pin = null;
      return;
    }
    if (layers.pin) {
      layers.pin.setLatLng([pin.lat, pin.lng]);
      return;
    }
    layers.pin = L.marker([pin.lat, pin.lng], {
      icon: L.divIcon({
        html: myPinHtml(colors),
        className: '',
        iconSize: [MY_PIN_SIZE, MY_PIN_SIZE],
        iconAnchor: [MY_PIN_SIZE / 2, MY_PIN_SIZE / 2],
      }),
      draggable: true,
      keyboard: false,
    }).addTo(layers.map);
    layers.pin.on('dragend', () => {
      const latlng = layers.pin?.getLatLng();
      if (latlng) {
        interactRef.current.onPinChange?.({ lat: latlng.lat, lng: latlng.lng });
      }
    });
  }, [pin, colors, mapEpoch]);

  // ── Тема: класс-модификатор контейнера (фильтр тайлов) ───────────────────

  useEffect(() => {
    const div = divRef.current;
    if (div) {
      div.classList.toggle(containerClassFor('dark'), mode === 'dark');
    }
  }, [mode]);

  // Простой DOM div (Leaflet — императивная DOM-библиотека): в .web-файле
  // валидны HTML-элементы (как SVG в предыдущей версии карты).
  return (
    <div
      ref={divRef}
      className={containerClassFor(mode)}
      role="application"
      aria-label="Карта рынка"
      style={{
        height,
        width: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        background: colors.canvas,
      }}
    />
  );
}
