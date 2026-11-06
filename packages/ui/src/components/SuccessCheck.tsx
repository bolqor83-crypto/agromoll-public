/**
 * SuccessCheck — сдержанная success-анимация (v0.6.1-E2, ADR-027).
 *
 * Успех действия подтверждается телом: зелёная галочка в круге,
 * scale 0→1.1→1 + opacity 0→1 (400 мс, spring) и лёгкий haptic success.
 * Не конфетти и не салют — рынок в 4 утра, радость тихая (ADR-002/009).
 *
 * Живёт поверх контента ~1 с и исчезает (onDone — например, для
 * перечитывания списка). Reduced motion — без масштаба, только
 * мгновенное появление.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { success } from '../haptics';
import { radius } from '../tokens';
import { Icon } from './Icon';

/** Пружина «пружинистой» галочки (ADR-027: 400 мс spring). */
const SUCCESS_SPRING = { damping: 14, mass: 0.7, stiffness: 260 };
/** Сколько галочка живёт на экране до исчезновения. */
const VISIBLE_MS = 1000;

export interface SuccessCheckProps {
  /** Вызывается, когда галочка закончила показ (контент можно обновить). */
  onDone?: () => void;
  /** Переопределение reduced motion (для тестов). */
  reducedMotion?: boolean;
  /** Компактный вариант — внутри строки/бейджа. */
  size?: 'md' | 'sm';
  testID?: string;
}

export function SuccessCheck({
  onDone,
  reducedMotion,
  size = 'md',
  testID = 'success-check',
}: SuccessCheckProps) {
  const { colors } = useTheme();
  const systemReduced = useReducedMotion();
  const reduced = reducedMotion ?? systemReduced;

  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    success();
    if (reduced) {
      scale.value = 1;
      opacity.value = 1;
    } else {
      // Появление: чуть больше единицы и обратно — «пружинистый» акцент.
      scale.value = withSequence(
        withSpring(1.1, SUCCESS_SPRING),
        withSpring(1, { damping: 16, mass: 0.6, stiffness: 300 }),
      );
      opacity.value = withTiming(1, { duration: 200 });
    }
    if (onDone) {
      const timer = setTimeout(onDone, VISIBLE_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  const boxSize = size === 'md' ? 72 : 36;
  const iconSize = size === 'md' ? 36 : 20;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View
      testID={testID}
      accessibilityLabel="Готово"
      accessibilityRole="alert"
      pointerEvents="none"
      style={{
        width: boxSize,
        height: boxSize,
        borderRadius: boxSize / 2,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
      }}
    >
      <Animated.View
        style={[
          animatedStyle,
          {
            width: boxSize,
            height: boxSize,
            borderRadius: boxSize / 2,
            // Мягкая зелёная подложка из темы (без литералов, ADR-009/B8)
            backgroundColor: colors.primaryMuted,
            alignItems: 'center',
            justifyContent: 'center',
          },
        ]}
      >
        <View
          style={{
            width: boxSize * 0.62,
            height: boxSize * 0.62,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="checkmark-circle-outline" size={iconSize} color="primary" />
        </View>
      </Animated.View>
    </View>
  );
}
