/**
 * Тесты рендера витрины в демо-режиме (v0.6.1-D, ADR-026, вариант B):
 * демо-лоты + DemoBanner, FAB «Выставить лот» и «Моя линия на карте»
 * отключены — без сервера лот сохранить нельзя.
 */
import { render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/outbox', () => require('@/test/screen-mocks').createOutboxStoreMock());
jest.mock('@/store/auth', () =>
  require('@/test/screen-mocks').createAuthStoreMock({
    id: 'u-2',
    role: 'seller',
    displayName: 'ФХ «Донская долина»',
    phone: '+79610000001',
    phoneVerified: true,
    totalConfirmations: 7,
    totalDisputes: 0,
    createdAt: new Date().toISOString(),
  }),
);
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());
jest.mock('@/components/DebtSummaryWidget', () => ({
  DebtSummaryWidget: () => null,
}));
jest.mock('@/components/MyPointSheet', () => ({
  MyPointSheet: () => null,
  MARKET_CENTER: { lat: 47.2224, lng: 39.7138 },
}));
jest.mock('@/components/CreateListingModal', () => ({
  CreateListingModal: () => null,
}));

// eslint-disable-next-line import/first -- моки должны объявиться до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import ShowcaseScreen from './ShowcaseScreen';

const mockApi = api as unknown as { myListings: jest.Mock };

function renderShowcase() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ShowcaseScreen />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('Витрина в демо-режиме — вариант B (ADR-026)', () => {
  beforeEach(() => {
    mockApi.myListings.mockReset();
  });

  it('API недоступен → демо-лоты + DemoBanner + FAB отключен', async () => {
    mockApi.myListings.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderShowcase();

    // Демо-лоты видны (витрина — витрина продукта, ADR-026).
    await waitFor(() => expect(screen.getByText('Помидоры розовые')).toBeTruthy(), {
      timeout: 3000,
    });
    // Честный баннер.
    expect(screen.getByTestId('demo-banner')).toBeTruthy();
    expect(screen.getByText(/API недоступен\. Данные не настоящие/)).toBeTruthy();

    // FAB «Выставить лот» отключён: без сервера лот не сохранить.
    const fab = screen.getByLabelText('Выставить лот');
    expect(fab.props.accessibilityState?.disabled).toBe(true);

    // «Моя линия на карте» тоже требует сервер.
    const line = screen.getByRole('button', { name: 'Моя линия на карте' });
    expect(line.props.accessibilityState?.disabled).toBe(true);
  });

  it('INVALID_RESPONSE → ErrorState, демо не показываем', async () => {
    mockApi.myListings.mockRejectedValue({
      message: 'API вернул неверный формат',
      code: 'INVALID_RESPONSE',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderShowcase();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Данные пришли в неожиданном виде')).toBeTruthy();
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });
});
