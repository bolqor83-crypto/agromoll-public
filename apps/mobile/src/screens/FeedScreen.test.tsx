/**
 * Тесты рендера ленты в демо-режиме (v0.6.1-D, ADR-026, вариант B):
 * API недоступен → демо-карточки + полноширинный янтарный DemoBanner
 * «Демо-режим. API недоступен. Данные не настоящие», кнопки «Рядом со
 * мной» и «Моя точка» отключены.
 */
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
    const nearby = screen.getByRole('button', { name: 'Рядом со мной' });
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
