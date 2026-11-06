/**
 * Тесты адаптивности v0.6.2-D (ADR-030): контентная колонка 600 px на
 * широких экранах, кап таб-бара, 2 колонки ленты/витрины на планшете.
 *
 * useWindowDimensions мокается частичным моком react-native — остальные
 * модули (Animated, SafeAreaView…) работают как в обычных тестах.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { Screen, TabBar, ThemeProvider, useResponsive } from '@agromoll/ui';
import type { TabBarItem } from '@agromoll/ui';

// useWindowDimensions шпионим по ОРИГИНАЛЬНОМУ объекту экспортов react-native:
// `import * as RN` с babel-интеропом даёт копию namespace (spy патчит копию,
// а компоненты читают оригинал), а фабричный jest.mock c requireActual
// обходит моки jest-expo и падает на TurboModuleRegistry. require + spyOn
// меняет экспорт на месте — компоненты видят мок.
const ReactNative: typeof import('react-native') = require('react-native');
const mockDimensions = jest.spyOn(ReactNative, 'useWindowDimensions');

function setWidth(width: number): void {
  mockDimensions.mockReturnValue({ width, height: 900, scale: 2, fontScale: 1 });
}

afterEach(() => {
  mockDimensions.mockReset();
});

function flatten(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) ?? {};
}

/** Рендер-прослойка: вытаскивает значение хука в тест. */
function ResponsiveProbe({ onValue }: { onValue: (v: ReturnType<typeof useResponsive>) => void }) {
  onValue(useResponsive());
  return null;
}

describe('Screen — контентная колонка max-width 600 (аудит №16)', () => {
  it('телефон 375: колонка не ограничена', () => {
    setWidth(375);
    const screen = render(
      <ThemeProvider>
        <Screen>
          <View />
        </Screen>
      </ThemeProvider>,
    );
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const style = flatten(scroll.props.style);
    expect(style.maxWidth).toBeUndefined();
  });

  it('широкий телефон 430+: колонка 600 px по центру', () => {
    setWidth(430);
    const screen = render(
      <ThemeProvider>
        <Screen>
          <View />
        </Screen>
      </ThemeProvider>,
    );
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const style = flatten(scroll.props.style);
    expect(style.maxWidth).toBe(600);
    expect(style.alignSelf).toBe('center');
    expect(style.width).toBe('100%');
  });

  it('планшет 1024: колонка 600 px по центру', () => {
    setWidth(1024);
    const screen = render(
      <ThemeProvider>
        <Screen>
          <View />
        </Screen>
      </ThemeProvider>,
    );
    const scroll = screen.UNSAFE_getByType(ScrollView);
    expect(flatten(scroll.props.style).maxWidth).toBe(600);
  });

  it('maxContentWidth={false}: полноширинный экран (карты и т.п.)', () => {
    setWidth(1024);
    const screen = render(
      <ThemeProvider>
        <Screen maxContentWidth={false}>
          <View />
        </Screen>
      </ThemeProvider>,
    );
    const scroll = screen.UNSAFE_getByType(ScrollView);
    expect(flatten(scroll.props.style).maxWidth).toBeUndefined();
  });

  it('scroll=false: та же колонка на внутреннем View', () => {
    setWidth(800);
    const screen = render(
      <ThemeProvider>
        <Screen scroll={false}>
          <View testID="screen-child" />
        </Screen>
      </ThemeProvider>,
    );
    // поднимаемся по предкам до обёртки контентной колонки (могут быть
    // промежуточные composite-узлы без стиля)
    let node = screen.getByTestId('screen-child').parent as unknown as {
      props: { style?: unknown };
      parent?: unknown;
    } | null;
    while (node && flatten(node.props?.style).maxWidth === undefined) {
      node = node.parent as typeof node;
    }
    expect(node).not.toBeNull();
    expect(flatten(node?.props.style).maxWidth).toBe(600);
  });

  it('useResponsive через рендер: 768+ — планшет, 2 колонки', () => {
    setWidth(768);
    let value: ReturnType<typeof useResponsive> | undefined;
    render(
      <ThemeProvider>
        <ResponsiveProbe onValue={(v) => (value = v)} />
      </ThemeProvider>,
    );
    expect(value?.isTablet).toBe(true);
    expect(value?.cardColumns).toBe(2);
    expect(value?.isWidePhone).toBe(true);

    setWidth(375);
    render(
      <ThemeProvider>
        <ResponsiveProbe onValue={(v) => (value = v)} />
      </ThemeProvider>,
    );
    expect(value?.isTablet).toBe(false);
    expect(value?.cardColumns).toBe(1);
    expect(value?.isWidePhone).toBe(false);
  });
});

describe('TabBar — панель не растягивается на широких экранах (аудит №15)', () => {
  const items: TabBarItem[] = [
    { key: 'feed', label: 'Лента', icon: 'leaf-outline' },
    { key: 'bookings', label: 'Брони', icon: 'calendar-outline' },
  ];

  it('телефон: без ограничения ширины', () => {
    setWidth(375);
    const screen = render(
      <ThemeProvider>
        <TabBar items={items} activeKey="feed" onChange={jest.fn()} />
      </ThemeProvider>,
    );
    // 'tablist' нет в ARIA-карте RTL — ищем по пропсу (паттерн design-system.test)
    const bar = screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' });
    expect(flatten(bar.props.style).maxWidth).toBeUndefined();
  });

  it('планшет: кап 600 по центру, вкладки в строку', () => {
    setWidth(1024);
    const screen = render(
      <ThemeProvider>
        <TabBar items={items} activeKey="feed" onChange={jest.fn()} />
      </ThemeProvider>,
    );
    const bar = screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' });
    const style = flatten(bar.props.style);
    expect(style.maxWidth).toBe(600);
    expect(style.alignSelf).toBe('center');
    expect(style.flexDirection).toBe('row');
  });
});
