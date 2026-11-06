/**
 * ShakeField — покачивание поля при ошибке валидации (v0.6.1-E2, ADR-027).
 *
 * «Нет» формы должно ощущаться телом: лёгкое покачивание поля ввода
 * (translateX 0→−4→4→−4→0, 300 мс) + haptic warning. Не для сетевых
 * ошибок — там ErrorState (ADR-026): shake — про ЛОКАЛЬНУЮ ошибку,
 * которую пользователь видит и может исправить прямо сейчас.
 *
 * Триггер — инкрементируемый shakeKey: родитель увеличивает счётчик,
 * когда значение стало невалидным. Reduced motion — без движения,
 * haptic остаётся (тактильность — не движение).
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { warning } from '../haptics';

/** Полный цикл покачивания: 4 шага × 75 мс = 300 мс (ADR-027). */
const SHAKE_STEP_MS = 75;
/** Амплитуда: 4 px — заметно, но не «трясёт» весь экран. */
const SHAKE_DX = 4;

export interface ShakeFieldProps {
  /** Увеличьте — и поле качнётся. 0 на старте — не качается. */
  shakeKey: number;
  children: ReactNode;
  /** Переопределение reduced motion (для тестов). */
  reducedMotion?: boolean;
  testID?: string;
}

export function ShakeField({ shakeKey, children, reducedMotion, testID }: ShakeFieldProps) {
  const systemReduced = useReducedMotion();
  const reduced = reducedMotion ?? systemReduced;
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (shakeKey <= 0) {
      return;
    }
    warning();
    if (!reduced) {
      translateX.value = withSequence(
        withTiming(-SHAKE_DX, { duration: SHAKE_STEP_MS }),
        withTiming(SHAKE_DX, { duration: SHAKE_STEP_MS }),
        withTiming(-SHAKE_DX, { duration: SHAKE_STEP_MS }),
        withTiming(0, { duration: SHAKE_STEP_MS }),
      );
    }
    // translateX/reduced не в зависимостях: shared value стабилен,
    // триггер — только shakeKey
  }, [shakeKey]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Animated.View testID={testID} style={animatedStyle}>
      {children}
    </Animated.View>
  );
}
