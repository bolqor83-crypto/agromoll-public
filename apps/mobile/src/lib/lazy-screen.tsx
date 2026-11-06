/**
 * lazyScreen — ленивая загрузка экрана с Suspense-фолбэком (v0.6.1-A, ADR-023).
 *
 * Code splitting по маршрутам: файл маршрута в app/ — тонкая обёртка,
 * реальный код экрана живёт в src/screens и подтягивается динамическим
 * import() отдельным чанком (Metro splitChunks при expo export).
 *
 * Фолбэк — Skeleton-карточки, НЕ спиннер и не пустой экран: философия
 * приложения — «спиннеров нет» (ADR-009), загрузка выглядит как макет
 * будущего экрана. expo-router 4 не даёт настроить свой Suspense-фолбэк
 * (хардкод null в prod), поэтому граница Suspense — здесь, в обёртке.
 *
 * v0.6.1-E2 (ADR-027): TabScreenMotion — плавный переход между вкладками
 * (fade + slide 8→0, 200 мс). bottom-tabs держит посещённые экраны
 * смонтированными, поэтому анимация вешается не на mount, а на ПОЯВЛЕНИЕ
 * ФОКУСА (useIsFocused): вкладка «вплывает» при каждом переключении.
 * Первый вход — тоже анимирован (после Suspense-скелета). Prefetch и
 * ленивые чанки (ADR-023) не затронуты: обёртка выше границы Suspense.
 */
import { Suspense, lazy, useEffect, useRef } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Screen, Skeleton, SkeletonCard, spacing } from '@agromoll/ui';

/** Вариант скелета под тип экрана (списки против «одной большой карточки»). */
export type ScreenFallbackKind = 'cards' | 'plain';

/** Длительность перехода вкладки (ADR-027: 200 мс, из motion.fast). */
const TAB_TRANSITION_MS = 200;
/** Сдвиг входящего экрана: 8 px — «приплыл», а не «влетел». */
const TAB_SLIDE_DX = 8;

/**
 * Переход между вкладками: входящий экран — opacity 0→1 + translateX 8→0.
 * Исходящий скрывается навигатором мгновенно (bottom-tabs не даёт
 * анимировать исходящий без форков — ADR-027): входящая анимация
 * закрывает «вакуум», переключение читается как плавное.
 */
export function TabScreenMotion({ children }: { children: ReactNode }): ReactNode {
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  // Reduced motion: стартуем видимыми — ни одного «пустого» кадра.
  const opacity = useSharedValue(reduced ? 1 : 0);
  const translateX = useSharedValue(reduced ? 0 : TAB_SLIDE_DX);
  const wasFocused = useRef(false);

  useEffect(() => {
    // Первый mount и каждое возвращение фокуса — «вплываем».
    if (focused && !wasFocused.current && !reduced) {
      opacity.value = 0;
      translateX.value = TAB_SLIDE_DX;
      opacity.value = withTiming(1, { duration: TAB_TRANSITION_MS });
      translateX.value = withTiming(0, { duration: TAB_TRANSITION_MS });
    } else if (focused) {
      // Reduced motion или повторный фокус после сброса — просто видимы.
      opacity.value = 1;
      translateX.value = 0;
    }
    wasFocused.current = focused;
  }, [focused, reduced, opacity, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return <Animated.View style={[{ flex: 1 }, animatedStyle]}>{children}</Animated.View>;
}

/** Заголовок-скелет: серо-тёплая полоса на месте ScreenHeader. */
function HeaderSkeleton(): ReactNode {
  return (
    <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <Skeleton height={28} width={220} />
      <Skeleton height={16} width={150} />
    </View>
  );
}

/**
 * Фолбэк Suspense: каркас экрана из скелетов.
 * 'cards' — ленты/списки (карточки-скелеты), 'plain' — детали/формы.
 * accessibilityLabel — скринридер объявляет «Экран загружается».
 */
export function ScreenSkeleton({ kind = 'cards' }: { kind?: ScreenFallbackKind }): ReactNode {
  return (
    <View accessibilityLabel="Экран загружается" testID="screen-skeleton" style={{ flex: 1 }}>
      <Screen scroll={false}>
        <HeaderSkeleton />
        <View style={{ gap: spacing.md, padding: spacing.lg }}>
          {kind === 'cards' ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <Skeleton height={180} />
              <Skeleton height={56} />
              <Skeleton height={56} />
            </>
          )}
        </View>
      </Screen>
    </View>
  );
}

/**
 * Оборачивает динамический импорт экрана в React.lazy + Suspense(Skeleton)
 * + TabScreenMotion (плавные переходы вкладок, ADR-027).
 *
 * @param loader  () => import('@/screens/X') — модуль с default-экспортом
 *                (или .then(m => ({ default: m.X })) для именованных).
 * @param kind    вариант скелета: 'cards' (по умолчанию) или 'plain'.
 */
export function lazyScreen(
  loader: () => Promise<{ default: ComponentType<unknown> }>,
  kind: ScreenFallbackKind = 'cards',
): ComponentType<unknown> {
  const Content = lazy(loader);

  function LazyScreen(): ReactNode {
    return (
      <Suspense fallback={<ScreenSkeleton kind={kind} />}>
        {/* Внутри Suspense: анимация приходится на появление КОНТЕНТА,
            а не скелета; на повторных переключениях вкладок TabScreenMotion
            уже смонтирован и реагирует на фокус (ADR-027). */}
        <TabScreenMotion>
          <Content />
        </TabScreenMotion>
      </Suspense>
    );
  }
  LazyScreen.displayName = 'LazyScreen';
  return LazyScreen;
}
