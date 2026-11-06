/**
 * Онбординг первого запуска (v0.6.2-C, ADR-029).
 *
 * 3 слайда: «Закупайтесь быстрее» / «Доставка попутчиками» /
 * «Репутация и доверие». Показывается ОДИН раз — после выбора роли,
 * перед главным экраном роли (не блокирует вход: «Пропустить» рядом
 * с «Далее»). Флаг — AsyncStorage/localStorage (lib/first-run).
 *
 * Иллюстрации — геометрические композиции в токенах дизайн-системы
 * (как EmptyState): карточки лотов, грузовик-попутчик, рейтинг-звезда.
 * Свайп слайдов — pagingEnabled ScrollView; точки-индикатор анимируются.
 *
 * Маршрут принимает ?next=<route> — куда вернуться после завершения.
 */
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeInDown, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import {
  Button,
  Icon,
  motion,
  radius,
  Screen,
  selection,
  spacing,
  tap,
  Text,
  useTheme,
} from '@agromoll/ui';
// useTheme используется в подслоях (Dots/иллюстрации)
import { markOnboardingSeen } from '@/lib/first-run';
import { logger } from '@/lib/logger';

interface Slide {
  title: string;
  description: string;
}

const SLIDES: Slide[] = [
  {
    title: 'Закупайтесь быстрее',
    description:
      'Лента оптовых лотов рынка: цена, остатки и линия продавца — сразу в карточке. Бронь держит товар 2 часа.',
  },
  {
    title: 'Доставка попутчиками',
    description:
      'Водители по пути заберут заказ с линии продавца и привезут к вашей точке. Без посредников и наценок.',
  },
  {
    title: 'Репутация и доверие',
    description:
      'Рейтинг растёт с каждой сделкой, а договорённости видны обеим сторонам. Рынок, где все свои.',
  },
];

/** Ширина слайда подставляется при замере (onLayout) — точки считают проценты. */
export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const slideWidth = useRef(0);
  const isLast = index === SLIDES.length - 1;

  const finish = useCallback(() => {
    tap();
    void markOnboardingSeen().catch((error) => {
      logger.warn('onboarding', 'не удалось сохранить флаг', { error: String(error) });
    });
    const next = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/';
    router.replace(next as never);
  }, [params.next, router]);

  const goNext = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    selection();
    scrollRef.current?.scrollTo({ x: (index + 1) * slideWidth.current, animated: true });
  }, [finish, index, isLast]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const width = event.nativeEvent.layoutMeasurement.width;
    if (width > 0) {
      slideWidth.current = width;
      setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
    }
  }, []);

  return (
    <Screen scroll={false} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1 }}>
        {/* Слайды */}
        <ScrollView
          ref={scrollRef}
          testID="onboarding-slides"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          style={{ flex: 1 }}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {SLIDES.map((slide, i) => (
            <View
              key={slide.title}
              style={{ alignItems: 'center', gap: spacing.xl, paddingHorizontal: spacing.xl }}
              onLayout={(e) => {
                slideWidth.current = e.nativeEvent.layout.width;
              }}
            >
              <OnboardingIllustration index={i} />
              <Animated.View
                key={`text-${i}-${index === i ? 'on' : 'off'}`}
                entering={FadeInDown.springify().damping(16).stiffness(200)}
                style={{ alignItems: 'center', gap: spacing.md }}
              >
                <Text variant="display" align="center">
                  {slide.title}
                </Text>
                <Text variant="body" color="secondary" align="center" style={{ maxWidth: 300 }}>
                  {slide.description}
                </Text>
              </Animated.View>
            </View>
          ))}
        </ScrollView>

        {/* Низ: точки + кнопки */}
        <View style={{ gap: spacing.lg, paddingBottom: spacing.xl }}>
          <Dots count={SLIDES.length} active={index} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Пропустить онбординг"
              onPress={finish}
              style={({ pressed }) => ({
                minHeight: 48,
                paddingHorizontal: spacing.lg,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: radius.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="body" color="muted">
                Пропустить
              </Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button
                title={isLast ? 'Начать' : 'Далее'}
                onPress={goNext}
                iconLeft={
                  isLast ? <Icon name="arrow-forward-outline" size={20} color="onPrimary" /> : null
                }
              />
            </View>
          </View>
        </View>
      </View>
    </Screen>
  );
}

/** Точки-индикатор: активная растягивается в пилюлю (spring). */
function Dots({ count, active }: { count: number; active: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
      {Array.from({ length: count }, (_, i) => (
        <Dot key={i} active={i === active} color={i === active ? colors.primary : colors.border} />
      ))}
    </View>
  );
}

function Dot({ active, color }: { active: boolean; color: string }) {
  const width = useAnimatedStyle(() => ({
    width: withSpring(active ? 28 : 8, motion.pressSpring),
    backgroundColor: withTiming(color, { duration: motion.normal }),
  }));
  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        width,
        { height: 8, borderRadius: 999 },
      ]}
    />
  );
}

/**
 * Геометрические иллюстрации в токенах дизайн-системы (как EmptyState,
 * крупнее): слайд 1 — карточки лотов, слайд 2 — грузовик, слайд 3 — звезда.
 */
function OnboardingIllustration({ index }: { index: number }) {
  const { colors } = useTheme();
  switch (index) {
    case 0:
      return <ListingsIllustration colors={colors} />;
    case 1:
      return <TruckRouteIllustration colors={colors} />;
    default:
      return <ReputationIllustration colors={colors} />;
  }
}

type Palette = ReturnType<typeof useTheme>['colors'];

/** Слайд 1: стопка карточек лотов — цена, картинка-заглушка, бейдж. */
function ListingsIllustration({ colors }: { colors: Palette }) {
  const card = (offset: number, opacity: number): React.ReactNode => (
    <View
      style={{
        width: 200,
        height: 64,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.md,
        opacity,
        transform: [{ translateY: offset }],
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: colors.primaryMuted,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.primary }} />
      </View>
      <View style={{ gap: 6, flex: 1 }}>
        <View style={{ width: 120, height: 12, borderRadius: 6, backgroundColor: colors.textSecondary, opacity: 0.55 }} />
        <View style={{ width: 76, height: 10, borderRadius: 5, backgroundColor: colors.primary, opacity: 0.75 }} />
      </View>
      <View
        style={{
          paddingHorizontal: 10,
          height: 22,
          borderRadius: 999,
          backgroundColor: colors.primaryMuted,
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 28, height: 8, borderRadius: 4, backgroundColor: colors.primary, opacity: 0.7 }} />
      </View>
    </View>
  );
  return (
    <View style={{ alignItems: 'center', height: 200, justifyContent: 'center' }}>
      {card(0, 0.45)}
      {card(-28, 0.75)}
      {card(-56, 1)}
    </View>
  );
}

/** Слайд 2: грузовик на маршруте — точки A→Б и дуга-дорога. */
function TruckRouteIllustration({ colors }: { colors: Palette }) {
  return (
    <View style={{ width: 240, height: 200, justifyContent: 'center', alignItems: 'center' }}>
      {/* Дорога: линия с штрихами */}
      <View
        style={{
          position: 'absolute',
          width: 220,
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.border,
        }}
      />
      {/* Грузовик (геометрия EmptyState 'truck', крупнее) */}
      <View style={{ alignItems: 'center', marginBottom: 26 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View
            style={{
              width: 84,
              height: 54,
              backgroundColor: colors.primaryMuted,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderBottomLeftRadius: 5,
            }}
          />
          <View
            style={{
              width: 42,
              height: 42,
              backgroundColor: colors.primary,
              borderTopLeftRadius: 5,
              borderTopRightRadius: 16,
              borderBottomRightRadius: 16,
              marginLeft: 6,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 16,
                height: 14,
                borderRadius: 4,
                backgroundColor: colors.surface,
                opacity: 0.9,
              }}
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 44, marginTop: -8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text }} />
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text }} />
        </View>
      </View>
      {/* Точки маршрута */}
      <View
        style={{
          position: 'absolute',
          left: 4,
          bottom: 76,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: colors.primary,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 4,
          bottom: 76,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: colors.warning,
        }}
      />
    </View>
  );
}

/** Слайд 3: звезда рейтинга в мягком круге + растущие деления. */
function ReputationIllustration({ colors }: { colors: Palette }) {
  return (
    <View style={{ width: 240, height: 200, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: colors.primaryMuted,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* Звезда из ромбов (геометрия, без иконочных шрифтов) */}
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: 34,
              height: 34,
              backgroundColor: colors.primary,
              transform: [{ rotate: '45deg' }],
              borderRadius: 8,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: colors.primary,
              top: -6,
            }}
          />
        </View>
      </View>
      {/* Деления шкалы — «репутация растёт» */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'flex-end' }}>
        {[10, 16, 22, 30].map((h, i) => (
          <View
            key={h}
            style={{
              width: 10,
              height: h,
              borderRadius: 5,
              backgroundColor: i === 3 ? colors.warning : colors.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}
