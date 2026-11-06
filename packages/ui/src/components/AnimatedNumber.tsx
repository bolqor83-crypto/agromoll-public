/**
 * AnimatedNumber — плавный пересчёт числа (v0.6.1-E2, ADR-027).
 *
 * Счётчики (сумма долгов, часы, рейтинг) меняются «скачком» — глаз не
 * успевает заметить, ЧТО изменилось и НА СКОЛЬКО. Компонент пробегает
 * цифры от старого значения к новому за 400 мс: движение числа само
 * говорит «стало больше/меньше».
 *
 * Реализация: прогресс 0→1 на UI-потоке (withTiming), интерполяция
 * старое→новое в useDerivedValue, текст обновляется через
 * useAnimatedReaction + runOnJS. Форматирование живёт на JS-потоке
 * (ворклеты не умеют Intl): reaction передаёт только число, формат —
 * в стабильном колбэке. Финальное значение синхронизируется эффектом —
 * корректность важнее анимации (и это делает компонент тестируемым:
 * мок Reanimated не исполняет reactions).
 *
 * Reduced motion (useReducedMotion, ADR-027): без пробега — новое
 * значение появляется сразу.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Text } from './Text';
import type { TextColor, TextProps } from './Text';

/** Длительность пробега цифр (ADR-027: 400 мс). */
const COUNT_MS = 400;

export interface AnimatedNumberProps {
  /** Число для показа; изменение запускает пробег от старого к новому. */
  value: number;
  /** Форматирование (Intl и т.п.) — выполняется на JS-потоке. */
  format?: (value: number) => string;
  /** Переопределение reduced motion (для тестов). */
  reducedMotion?: boolean;
  variant?: TextProps['variant'];
  weight?: TextProps['weight'];
  color?: TextColor;
  testID?: string;
}

export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  reducedMotion,
  variant = 'body',
  weight,
  color,
  testID = 'animated-number',
}: AnimatedNumberProps) {
  const systemReduced = useReducedMotion();
  const reduced = reducedMotion ?? systemReduced;

  // Формат может пересоздаваться рендерами — держим актуальный в ref,
  // чтобы reaction-колбэк оставался стабильным для runOnJS.
  const formatRef = useRef(format);
  formatRef.current = format;

  const fromRef = useRef(value);
  const progress = useSharedValue(1);
  const [text, setText] = useState(() => format(value));

  /** Стабильный мост UI-поток → JS: только число, формат — на JS. */
  const applyValue = useCallback((n: number) => {
    setText(formatRef.current(n));
  }, []);

  // Пробег: прогресс 0→1, интерполяция from→value на UI-потоке.
  useEffect(() => {
    const previous = fromRef.current;
    fromRef.current = value;
    if (reduced || previous === value) {
      progress.value = 1;
      setText(format(value));
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: COUNT_MS });
    // Страховка финала: если reaction не дошёл (размонтирование и т.п.),
    // последняя синхронизация гарантирует точное значение.
    const timer = setTimeout(() => setText(format(value)), COUNT_MS + 60);
    return () => clearTimeout(timer);
  }, [value, reduced, progress]);

  const animatedValue = useDerivedValue(() =>
    interpolate(progress.value, [0, 1], [fromRef.current, value]),
  );

  useAnimatedReaction(
    () => animatedValue.value,
    (current) => {
      'worklet';
      runOnJS(applyValue)(current);
    },
  );

  return (
    <Text variant={variant} weight={weight} color={color} testID={testID}>
      {text}
    </Text>
  );
}
