/**
 * Тесты рендера «Моих броней» с ошибкой (v0.6.1-D, ADR-026, вариант A):
 * без демо-фейков — ErrorState с «Повторить»; локальные офлайн-брони
 * (настоящие!) не прячутся за ошибкой.
 */
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/outbox', () => require('@/test/screen-mocks').createOutboxStoreMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());
jest.mock('@/lib/outbox/mutations', () => ({
  acceptCounterMutation: jest.fn(),
  cancelBookingMutation: jest.fn(),
  confirmBookingMutation: jest.fn(),
  confirmDeliveryMutation: jest.fn(),
}));
jest.mock('@/components/ConfirmDeliveryModal', () => ({
  ConfirmDeliveryModal: () => null,
}));

// eslint-disable-next-line import/first -- моки должны объявиться до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { useOutboxStore } from '@/store/outbox';
// eslint-disable-next-line import/first
import BookingsScreen from './BookingsScreen';

const mockApi = api as unknown as { bookings: jest.Mock };

function renderBookings() {
  return render(
    <ThemeProvider>
      <BookingsScreen />
    </ThemeProvider>,
  );
}

describe('«Мои брони» с ошибкой — вариант A: без фейков (ADR-026)', () => {
  beforeEach(() => {
    mockApi.bookings.mockReset();
    useOutboxStore.setState({
      version: 0,
      overrides: {},
      pendingCreates: {},
      pendingCount: 0,
    });
  });

  it('сеть упала → ErrorState с «Повторить», демо-броней нет', async () => {
    mockApi.bookings.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderBookings();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Нет связи с сервером')).toBeTruthy();
    expect(screen.getByText('Повторить')).toBeTruthy();
    // Демо-данных больше нет — экран не притворяется рабочим.
    expect(screen.queryByText(/Демо/)).toBeNull();
  });

  it('INVALID_RESPONSE → тот же честный ErrorState', async () => {
    mockApi.bookings.mockRejectedValue({
      message: 'API вернул неверный формат',
      code: 'INVALID_RESPONSE',
      status: undefined,
      body: undefined,
      hint: undefined,
    });

    const screen = renderBookings();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Данные пришли в неожиданном виде')).toBeTruthy();
  });

  it('ошибка + локальная офлайн-бронь → бронь видна («Ждёт сети»), ошибка — рядом', async () => {
    mockApi.bookings.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });
    useOutboxStore.setState({
      pendingCreates: {
        'uuid-1': {
          listingId: 'l-1',
          listingTitle: 'Лук репчатый, ящик',
          listingUnit: 'box',
          requestedQuantity: 3,
          createdAt: new Date().toISOString(),
        },
      },
      pendingCount: 1,
    });

    const screen = renderBookings();

    // Локальная бронь — настоящие данные, не прячем за ошибкой.
    await waitFor(() => expect(screen.getByText('Лук репчатый, ящик')).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.getByText('Ждёт сети')).toBeTruthy();
    // И ошибка честно видна (inline, над списком).
    expect(screen.getByTestId('error-state')).toBeTruthy();
  });
});
