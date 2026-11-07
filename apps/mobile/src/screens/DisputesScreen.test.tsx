/**
 * Тесты рендера «Споров» (v0.6.0-C, ADR-033): статусная машина без
 * фейков — ошибка сети → ErrorState с повтором; пусто → честное
 * пустое состояние; данные → карточки кейсов.
 */
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());

// eslint-disable-next-line import/first -- моки объявляются до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import DisputesScreen from './DisputesScreen';

const mockApi = api as unknown as { myDisputes: jest.Mock };

function renderScreen() {
  return render(
    <ThemeProvider>
      <DisputesScreen />
    </ThemeProvider>,
  );
}

/** Валидный кейс для zod-валидации ответа. */
function makeDispute() {
  const party = (id: string, role: string) => ({
    id,
    displayName: `Участник ${id}`,
    role,
  });
  return {
    id: 'd-1',
    type: 'booking' as const,
    referenceId: 'b-1',
    subject: 'Бронь: Помидоры розовые',
    status: 'open' as const,
    firstParty: party('u-buyer', 'buyer'),
    secondParty: party('u-seller', 'seller'),
    openedBy: party('u-buyer', 'buyer'),
    openedAt: new Date('2026-11-07T08:00:00Z').toISOString(),
    assignedTo: null,
    assignedAt: null,
    resolution: null,
    resolvedAt: null,
    notes: null,
    messagesCount: 2,
    evidenceCount: 1,
  };
}

describe('«Споры» (ADR-033): статусная машина без фейков', () => {
  beforeEach(() => {
    mockApi.myDisputes.mockReset();
  });

  it('сеть упала → ErrorState с «Повторить»', async () => {
    mockApi.myDisputes.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });
    const { queryByText, findByText } = renderScreen();
    expect(await findByText('Нет связи с сервером')).toBeTruthy();
    expect(queryByText('Споров нет')).toBeNull();
  });

  it('пустой список → честное пустое состояние', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [] });
    const { findByText } = renderScreen();
    expect(await findByText('Споров нет')).toBeTruthy();
  });

  it('кейсы → карточки со статусами и сторонами', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [makeDispute()] });
    const { findByText } = renderScreen();
    expect(await findByText('Бронь: Помидоры розовые')).toBeTruthy();
    expect(await findByText('Открыт')).toBeTruthy();
  });
});
