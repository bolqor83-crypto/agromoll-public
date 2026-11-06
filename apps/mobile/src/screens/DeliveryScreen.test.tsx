/**
 * Тесты рендера «Доставки» покупателя с ошибкой (v0.6.1-D, ADR-026,
 * вариант A): раньше при ошибке первой загрузки deliveries оставался
 * null и экран вечно показывал skeleton. Теперь — ErrorState с
 * «Повторить».
 */
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/outbox', () => require('@/test/screen-mocks').createOutboxStoreMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());
jest.mock('@/lib/outbox/delivery-mutations', () => ({
  createDeliveryMutation: jest.fn(),
}));
jest.mock('@/components/CreateDeliverySheet', () => ({
  CreateDeliverySheet: () => null,
}));

// eslint-disable-next-line import/first -- моки должны объявиться до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import DeliveryScreen from './DeliveryScreen';

const mockApi = api as unknown as { deliveriesMine: jest.Mock };

function renderDelivery() {
  return render(
    <ThemeProvider>
      <DeliveryScreen />
    </ThemeProvider>,
  );
}

describe('«Доставка» покупателя с ошибкой — вариант A (ADR-026)', () => {
  beforeEach(() => {
    mockApi.deliveriesMine.mockReset();
  });

  it.each([
    ['сеть упала', 'NETWORK', 'Нет связи с сервером'],
    ['сервер ответил 500', 'SERVER', 'Сервер перегружен'],
  ])('%s → ErrorState с «Повторить», не вечный skeleton', async (_label, code, title) => {
    mockApi.deliveriesMine.mockRejectedValue({
      message: `ошибка ${code}`,
      status: code === 'SERVER' ? 500 : undefined,
      code,
      body: undefined,
      hint: undefined,
    });

    const screen = renderDelivery();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText('Повторить')).toBeTruthy();
    // Primary-действие экрана остаётся на месте (thumb zone, ADR-025).
    expect(screen.getByText('Заказать доставку')).toBeTruthy();
  });
});
