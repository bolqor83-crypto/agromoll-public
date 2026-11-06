/**
 * Тесты lazyScreen (v0.6.1-A, ADR-023): Suspense-фолбэк — Skeleton-каркас
 * (никаких спиннеров), после загрузки чанка рендерится сам экран.
 *
 * v0.6.1-E2 (ADR-027): TabScreenMotion — обёртка переходов вкладок
 * (fade + slide). useIsFocused требует навигатор — в юнит-тестах мокаем
 * @react-navigation/native переключаемым фокусом.
 */
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

// Фокус вкладки: управляется из теста (по умолчанию — экран активен).
// Мок объявлен до импорта модуля с TabScreenMotion (hoisting jest.mock).
const focusState = { focused: true };
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => focusState.focused,
}));

// eslint-disable-next-line import/first -- после jest.mock из-за hoisting
import { lazyScreen, ScreenSkeleton, TabScreenMotion } from './lazy-screen';

/** Контент «чанка» для проверки перехода фолбэк → экран. */
function ChunkContent() {
  return <Text>Контент экрана загружен</Text>;
}

beforeEach(() => {
  focusState.focused = true;
});

describe('lazyScreen: Suspense-фолбэк (ADR-023)', () => {
  it('пока чанк грузится — рендерится Skeleton-фолбэк, не пустота и не спиннер', async () => {
    const never = new Promise<{ default: typeof ChunkContent }>(() => {});
    const Lazy = lazyScreen(() => never);

    const screen = await render(
      <ThemeProvider>
        <Lazy />
      </ThemeProvider>,
    );

    // Каркас загрузки доступен скринридеру и виден пользователю.
    expect(screen.queryByTestId('screen-skeleton')).toBeTruthy();
    // Контент ещё не рендерится.
    expect(screen.queryByText('Контент экрана загружен')).toBeNull();
  });

  it('после загрузки чанка рендерится сам экран', async () => {
    const Lazy = lazyScreen(() => Promise.resolve({ default: ChunkContent }));

    const screen = await render(
      <ThemeProvider>
        <Lazy />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText('Контент экрана загружен')).toBeTruthy());
  });

  it('ScreenSkeleton рендерится и в варианте cards, и в plain', async () => {
    const cards = await render(
      <ThemeProvider>
        <ScreenSkeleton kind="cards" />
      </ThemeProvider>,
    );
    expect(cards.queryByTestId('screen-skeleton')).toBeTruthy();

    const plain = await render(
      <ThemeProvider>
        <ScreenSkeleton kind="plain" />
      </ThemeProvider>,
    );
    expect(plain.queryByTestId('screen-skeleton')).toBeTruthy();
  });
});

describe('TabScreenMotion: переход вкладок (ADR-027)', () => {
  it('рендерит детей при активной вкладке', async () => {
    const screen = await render(
      <ThemeProvider>
        <TabScreenMotion>
          <Text>Экран вкладки</Text>
        </TabScreenMotion>
      </ThemeProvider>,
    );
    expect(screen.getByText('Экран вкладки')).toBeTruthy();
  });

  it('потеря и возврат фокуса не ломают экран (переключение вкладок)', async () => {
    focusState.focused = false;
    const screen = await render(
      <ThemeProvider>
        <TabScreenMotion>
          <Text>Экран вкладки</Text>
        </TabScreenMotion>
      </ThemeProvider>,
    );

    // Возврат фокуса — «вплываем» (мок Reanimated доводит анимации мгновенно).
    focusState.focused = true;
    screen.rerender(
      <ThemeProvider>
        <TabScreenMotion>
          <Text>Экран вкладки после возврата</Text>
        </TabScreenMotion>
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('Экран вкладки после возврата')).toBeTruthy(),
    );
  });
});
