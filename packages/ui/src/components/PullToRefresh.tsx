/**
 * PullToRefreshScrollView — список с кастомным pull-to-refresh:
 * зелёный круг, плавно вращающийся при освежении.
 *
 * На native: собственная механика на Reanimated (протяжка крутит круг
 * пропорционально смещению, отпускание после порога запускает освежение
 * с тактильным откликом). На web (нет bounce-скролла) — стандартный
 * RefreshControl с цветом primary: жест недоступен, но обновление работает.
 */
import { useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme';

/** Протяжка в px, после которой отпускание запускает освежение. */
const REFRESH_THRESHOLD = 72;
/** Скорость непрерывного вращения при освежении: 1 оборот за 800 мс. */
const SPIN_PERIOD_MS = 800;

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export interface PullToRefreshScrollViewProps extends ScrollViewProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}

export function PullToRefreshScrollView({
  refreshing,
  onRefresh,
  children,
  contentContainerStyle,
  ...scrollViewProps
}: PullToRefreshScrollViewProps) {
  const { colors } = useTheme();
  const pull = useSharedValue(0);
  const spin = useSharedValue(0);
  const isRefreshing = useSharedValue(false);
  const indicatorHeight = useSharedValue(0);

  useEffect(() => {
    isRefreshing.value = refreshing;
    if (refreshing) {
      indicatorHeight.value = withTiming(56, { duration: 200, easing: Easing.out(Easing.quad) });
      spin.value = withRepeat(
        withTiming(360, { duration: SPIN_PERIOD_MS, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      spin.value = 0;
      cancelAnimation(spin);
      indicatorHeight.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) });
    }
  }, [refreshing, isRefreshing, indicatorHeight, spin]);

  const triggerRefresh = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onRefresh();
  }, [onRefresh]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      if (isRefreshing.value) {
        pull.value = 0;
        return;
      }
      // Отрицательное смещение — протяжка за пределы начала списка (iOS bounce).
      pull.value = Math.max(0, -event.contentOffset.y);
    },
    onEndDrag: (event) => {
      if (!isRefreshing.value && -event.contentOffset.y > REFRESH_THRESHOLD) {
        runOnJS(triggerRefresh)();
      }
      pull.value = 0;
    },
  });

  const indicatorStyle = useAnimatedStyle(() => ({
    height: indicatorHeight.value,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  }));

  const circleStyle = useAnimatedStyle(() => ({
    transform: [
      // Протяжка вращает круг пропорционально смещению, освежение — непрерывно.
      { rotate: `${spin.value + pull.value * 4}deg` },
      { scale: Math.min(1, 0.55 + pull.value / REFRESH_THRESHOLD / 2) },
    ],
  }));

  if (Platform.OS === 'web') {
    return (
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={contentContainerStyle}
        {...scrollViewProps}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <AnimatedScrollView
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      contentContainerStyle={contentContainerStyle}
      {...scrollViewProps}
    >
      <Animated.View style={indicatorStyle}>
        <Animated.View
          style={[
            circleStyle,
            {
              width: 32,
              height: 32,
              borderRadius: 16,
              borderWidth: 3,
              borderColor: colors.border,
              borderTopColor: colors.primary,
            },
          ]}
        />
      </Animated.View>
      {children}
    </AnimatedScrollView>
  );
}

/**
 * RefreshCircle — тот самый зелёный круг, отдельно (для переиспользования
 * в шапках экранов на web, где жеста нет).
 */
export function RefreshCircle({ size = 28 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: colors.border,
        borderTopColor: colors.primary,
      }}
    />
  );
}

export const PULL_TO_REFRESH_THRESHOLD = REFRESH_THRESHOLD;
