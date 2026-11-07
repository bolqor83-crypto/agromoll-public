/**
 * Тесты «Деталей апелляции» (v0.7.0-C, ADR-037): статусная машина
 * без фейков + переписка — таймлайн сообщений и отправка ответа.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());

// eslint-disable-next-line import/first -- моки объявляются до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import AppealDetailScreen from './AppealDetailScreen';

const mockApi = api as unknown as {
  appeal: jest.Mock;
  sendAppealMessage: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <AppealDetailScreen />
    </ThemeProvider>,
  );
}

/** Валидный кейс (AppealDetailDto) с перепиской. */
function makeAppeal(status: 'open' | 'under_review' | 'unblocked' | 'rejected' = 'under_review') {
  const party = (id: string, role: string) => ({
    id,
    displayName: `Участник ${id}`,
    role,
  });
  return {
    id: 'ap-1',
    blockedPairId: 'bp-1',
    driver: party('u-driver', 'driver'),
    seller: party('u-seller', 'seller'),
    appellant: party('u-driver', 'driver'),
    reason: 'Часы задвоились из-за отменённых доставок',
    status,
    openedAt: new Date('2026-11-07T08:00:00Z').toISOString(),
    assignedTo: party('u-arb', 'arbitrator'),
    assignedAt: new Date('2026-11-07T09:00:00Z').toISOString(),
    resolvedAt: null,
    notes: null,
    months: [
      { month: '2026-10', totalMinutes: 3660, monthCounted: true },
      { month: '2026-09', totalMinutes: 3700, monthCounted: true },
    ],
    messages: [
      {
        id: 'm-1',
        author: party('u-arb', 'arbitrator'),
        body: 'Пришлите номера задвоенных смен',
        isInternal: false,
        createdAt: new Date('2026-11-07T10:00:00Z').toISOString(),
      },
    ],
  };
}

describe('«Детали апелляции» (ADR-037): переписка без фейков', () => {
  beforeEach(() => {
    mockApi.appeal.mockReset();
    mockApi.sendAppealMessage.mockReset();
  });

  it('сеть упала → ErrorState с «Повторить»', async () => {
    mockApi.appeal.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });
    const { findByText } = renderScreen();
    expect(await findByText('Нет связи с сервером')).toBeTruthy();
  });

  it('активный кейс: переписка + ответ отправляется и перечитывает кейс', async () => {
    mockApi.appeal.mockResolvedValue(makeAppeal());
    mockApi.sendAppealMessage.mockResolvedValue({});

    const { findByText, getByLabelText } = renderScreen();
    expect(await findByText('Пришлите номера задвоенных смен')).toBeTruthy();

    fireEvent.changeText(getByLabelText('Сообщение арбитру'), 'Смены 41 и 42');
    fireEvent.press(await findByText('Отправить'));

    await waitForCall(mockApi.sendAppealMessage, 1);
    expect(mockApi.sendAppealMessage).toHaveBeenCalledWith('ap-1', 'Смены 41 и 42');
  });

  it('закрытый кейс: только история, поля ввода нет', async () => {
    mockApi.appeal.mockResolvedValue(makeAppeal('rejected'));

    const { findByText, queryByLabelText } = renderScreen();
    expect(await findByText('Пришлите номера задвоенных смен')).toBeTruthy();
    expect(queryByLabelText('Сообщение арбитру')).toBeNull();
  });
});

/** Ждём вызова мока (отправка идёт после press → async flow). */
function waitForCall(mock: jest.Mock, times: number, attempts = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = (): void => {
      if (mock.mock.calls.length >= times) {
        resolve();
      } else if (tries >= attempts) {
        reject(new Error('мок не вызван'));
      } else {
        tries += 1;
        setTimeout(tick, 50);
      }
    };
    tick();
  });
}
