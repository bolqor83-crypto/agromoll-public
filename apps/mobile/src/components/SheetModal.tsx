/**
 * SheetModal — модалка-«лист», выезжающая снизу с spring-физикой (v0.3.1).
 *
 * Вместо системного animationType="slide" (линейный, безжизненный):
 * контент поднимается пружиной ~300 мс, фон-затемнение проявляется.
 * Закрытие — обратная анимация 250 мс, и только потом Modal
 * размонтируется (системный Modal не даёт анимировать выход сам).
 *
 * Родитель управляет visible, как с обычным Modal; onClose вызывается
 * сразу (тап по фону), а анимация выхода доигрывается внутри.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { spacing, radius, useTheme } from '@agromoll/ui';
import { keyboardBehavior } from '@/lib/keyboard';

/** Пружина появления «листа» (~300 мс, ADR-009). */
const SHEET_SPRING = { damping: 18, mass: 0.9, stiffness: 260 };
/** Длительность ухода вниз и проявления фона, мс. */
const EXIT_MS = 250;

const absoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

export interface SheetModalProps {
  visible: boolean;
  /** Пользователь закрыл (тап по фону / системная кнопка «назад»). */
  onClose: () => void;
  children: ReactNode;
  /**
   * Прибитая к низу листа зона (v0.6.1-C, ADR-025): primary-кнопка не
   * «плавает» в середине контента, а всегда в thumb zone. Контент
   * листа скроллится, футер — нет.
   */
  footer?: ReactNode;
}

export function SheetModal({ visible, onClose, children, footer }: SheetModalProps) {
  const { colors } = useTheme();
  // Modal монтируется, пока идёт любая из анимаций (вход или выход).
  const [mounted, setMounted] = useState(visible);
  const sheetHeight = useRef(Dimensions.get('window').height);
  const translateY = useSharedValue(sheetHeight.current);
  const backdropOpacity = useSharedValue(0);

  // Открытие: монтируем и поднимаем лист пружиной.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      backdropOpacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, SHEET_SPRING);
    }
  }, [visible, backdropOpacity, translateY]);

  // Закрытие: лист вниз и фон гаснет, затем размонтируем Modal.
  useEffect(() => {
    if (!visible && mounted) {
      backdropOpacity.value = withTiming(0, { duration: EXIT_MS });
      translateY.value = withTiming(sheetHeight.current, { duration: EXIT_MS }, () => {
        runOnJS(() => setMounted(false))();
      });
    }
  }, [visible, mounted, backdropOpacity, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  if (!mounted) {
    return null;
  }

  return (
    <Modal transparent animationType="none" onRequestClose={onClose} accessibilityViewIsModal>
      <KeyboardAvoidingView
        // v0.6.1-B (ADR-024): iOS — padding (лист поднимается над клавиатурой),
        // Android — height (внутри Modal adjustResize не срабатывает), web — без поведения.
        behavior={keyboardBehavior}
        keyboardVerticalOffset={0}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        {/* Фон-затемнение: тап закрывает */}
        <Animated.View style={[absoluteFill, backdropStyle, { backgroundColor: colors.scrim }]}>
          <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={absoluteFill} />
        </Animated.View>

        {/* Лист: выезжает снизу пружиной. v0.6.1-B: верхние скругления
            radius.lg (ADR-024), overflow hidden — контент не вылезает
            за скруглённые углы, scrim виден за углами. */}
        <Animated.View
          style={[
            sheetStyle,
            {
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              overflow: 'hidden',
              backgroundColor: colors.background,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: footer ? spacing.sm : spacing.xxl }}
            keyboardShouldPersistTaps="handled"
            // v0.6.1-B: авто-скролл к активному инпуту (iOS 15+), ADR-024.
            automaticallyAdjustKeyboardInsets
          >
            {children}
          </ScrollView>
          {footer ? (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.sm,
                paddingBottom: spacing.lg,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
