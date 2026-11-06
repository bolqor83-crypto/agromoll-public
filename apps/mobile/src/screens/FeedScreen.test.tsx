/**
 * Тесты рендера ленты в демо-режиме (v0.6.1-D, ADR-026, вариант B):
 * API недоступен → демо-карточки + полноширинный янтарный DemoBanner
 * «Демо-режим. API недоступен. Данные не настоящие», кнопки «Рядом со
 * мной» и «Моя точка» отключены.
 *
 * v0.6.2-D: планшет ≥768 — лента в 2 колонки (ADR-030, аудит №15).
 */
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/outbox', () => require('@/test/screen-mocks').createOutboxStoreMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());
jest.mock('@/components/DebtSummaryWidget', () => ({
  DebtSummaryWidget: () => null,
}));
jest.mock('@/components/MyPointSheet', () => ({
  MyPointSheet: () => null,
  MARKET_CENTER: { lat: 47.2224, lng: 39.7138 },
}));

// v0.6.2-D: шпионим useWindowDimensions по оригинальному объекту экспортов
// (require — не `import *`, который с интеропом даёт копию namespace).
const ReactNative: typeof import('react-native') = require('react-native');
const mockDimensions = jest.spyOn(ReactNative, 'useWindowDimensions');

// eslint-disable-next-line import/first -- моки должны объявиться до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { FeedScreen } from './FeedScreen';

const mockApi = api as unknown as { listings: jest.Mock };

function renderFeed() {
  return render(
    <ThemeProvider>
      <FeedScreen />
    </ThemeProvider>,
  );
}

describe('Лента в демо-режиме — вариант B: баннер + отключённые кнопки (ADR-026)', () => {
  beforeEach(() => {
    mockApi.listings.mockReset();
    // телефон — базовый сценарий демо-режима
    mockDimensions.mockReturnValue({ width: 375, height: 667, scale: 2, fontScale: 1 });
  });

  it('API недоступен → демо-карточки + DemoBanner, кнопки geo отключены', async () => {
    mockApi.listings.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderFeed();

    // Демо-карточки на месте (лента — витрина продукта, ADR-026).
    await waitFor(() => expect(screen.getByText('Помидоры розовые')).toBeTruthy(), {
      timeout: 3000,
    });
    // Честный полноширинный баннер, а не маленький бейдж.
    expect(screen.getByTestId('demo-banner')).toBeTruthy();
    expect(screen.getByText('Демо-режим')).toBeTruthy();
    expect(screen.getByText(/API недоступен\. Данные не настоящие/)).toBeTruthy();

    // Кнопки, которым нужен сервер, отключены (a11y-состояние).
    const nearby = screen.getByRole('button', { name: 'Рядом' });
    expect(nearby.props.accessibilityState?.disabled).toBe(true);
    const myPoint = screen.getByRole('button', { name: 'Моя точка' });
    expect(myPoint.props.accessibilityState?.disabled).toBe(true);
  });

  it('INVALID_RESPONSE — НЕ демо: ErrorState с повтором', async () => {
    mockApi.listings.mockRejectedValue({
      message: 'API вернул неверный формат',
      code: 'INVALID_RESPONSE',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderFeed();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Данные пришли в неожиданном виде')).toBeTruthy();
    // Демо-баннера нет — неожиданный формат не маскируем витриной.
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });
});

describe('Лента на планшете — 2 колонки (v0.6.2-D, ADR-030)', () => {
  beforeEach(() => {
    mockApi.listings.mockReset();
    mockDimensions.mockReturnValue({ width: 1024, height: 768, scale: 2, fontScale: 1 });
  });

  it('≥768: карточки в сетке row + wrap, ширина колонки ~48.5%', async () => {
    mockApi.listings.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderFeed();

    await waitFor(() => expect(screen.getByText('Помидоры розовые')).toBeTruthy(), {
      timeout: 3000,
    });

    const grid = screen.getByTestId('listings-grid');
    const gridStyle = StyleSheet.flatten(grid.props.style) as Record<string, unknown>;
    expect(gridStyle.flexDirection).toBe('row');
    expect(gridStyle.flexWrap).toBe('wrap');
    expect(gridStyle.columnGap).toBe(12);

    // карточка-обёртка — половина колонки (минус gap)
    const card = screen.getByText('Помидоры розовые');
    // поднимаемся до узла с шириной (Animated.View-обёртка)
    let node = card.parent as unknown as { props: { style?: unknown }; parent?: unknown };
    while (node && (StyleSheet.flatten(node.props?.style) as Record<string, unknown>)?.width === undefined) {
      node = node.parent as typeof node;
    }
    expect(node).toBeDefined();
    const wrapperStyle = StyleSheet.flatten(node?.props?.style) as Record<string, unknown>;
    expect(wrapperStyle.width).toBe('48.5%');
  });

  it('телефон 375: одна колонка — сетка без row/wrap', async () => {
    mockDimensions.mockReturnValue({ width: 375, height: 667, scale: 2, fontScale: 1 });
    mockApi.listings.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderFeed();

    await waitFor(() => expect(screen.getByText('Помидоры розовые')).toBeTruthy(), {
      timeout: 3000,
    });

    const grid = screen.getByTestId('listings-grid');
    expect(grid.props.style).toBeUndefined();
  });
});
