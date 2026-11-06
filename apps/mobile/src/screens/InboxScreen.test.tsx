/**
 * Тесты рендера «Входящих» продавца с ошибкой (v0.6.1-D, ADR-026,
 * вариант A): без демо-фейков — чистый ErrorState с «Повторить».
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

// eslint-disable-next-line import/first -- моки должны объявиться до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { useOutboxStore } from '@/store/outbox';
// eslint-disable-next-line import/first
import InboxScreen from './InboxScreen';

const mockApi = api as unknown as { bookings: jest.Mock };

function renderInbox() {
  return render(
    <ThemeProvider>
      <InboxScreen />
    </ThemeProvider>,
  );
}

describe('«Входящие» с ошибкой — вариант A: без фейков (ADR-026)', () => {
  beforeEach(() => {
    mockApi.bookings.mockReset();
    useOutboxStore.setState({ version: 0, overrides: {}, pendingCreates: {}, pendingCount: 0 });
  });

  it.each([
    ['сеть упала', 'NETWORK', 'Нет связи с сервером'],
    ['сервер ответил 500', 'SERVER', 'Сервер перегружен'],
    ['сервер ответил мусором', 'INVALID_RESPONSE', 'Данные пришли в неожиданном виде'],
  ])('%s → ErrorState с «Повторить», демо-входящих нет', async (_label, code, title) => {
    mockApi.bookings.mockRejectedValue({
      message: `ошибка ${code}`,
      status: code === 'SERVER' ? 500 : undefined,
      code,
      body: undefined,
      hint: undefined,
    });

    const screen = renderInbox();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText('Повторить')).toBeTruthy();
    expect(screen.queryByText(/Демо/)).toBeNull();
  });
});
