/**
 * Тесты «Арбитража» (v0.6.0-C, ADR-033; апелляции — v0.6.0-E, ADR-035):
 * роль arbitrator видит очередь споров и вкладку апелляций 289-ФЗ,
 * остальные — честное «доступно только арбитрам».
 */
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());

/* eslint-disable import/first -- моки объявляются до импорта экрана */
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import ArbitrationScreen from './ArbitrationScreen';
/* eslint-enable import/first */

const mockApi = api as unknown as {
  disputeQueue: jest.Mock;
  appealQueue: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <ArbitrationScreen />
    </ThemeProvider>,
  );
}

/** Арбитр в сторе (роль из JWT + БД). */
function signInAsArbitrator(): void {
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: 'arb-1',
      role: 'arbitrator',
      displayName: 'Арбитр',
      phone: '+79610000001',
      phoneVerified: true,
      totalConfirmations: 0,
      totalDisputes: 0,
      createdAt: new Date().toISOString(),
    },
    signOutNotice: null,
  });
}

describe('«Арбитраж» (ADR-033): доступ по роли', () => {
  beforeEach(() => {
    mockApi.disputeQueue.mockReset();
    mockApi.appealQueue.mockReset();
  });

  it('покупателю — честное «Доступно только арбитрам», очередь не запрашивается', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u-1',
        role: 'buyer',
        displayName: 'Тестовый покупатель',
        phone: '+79610000000',
        phoneVerified: true,
        totalConfirmations: 0,
        totalDisputes: 0,
        createdAt: new Date().toISOString(),
      },
      signOutNotice: null,
    });
    const { getByText } = renderScreen();
    expect(getByText('Доступно только арбитрам')).toBeTruthy();
    expect(mockApi.disputeQueue).not.toHaveBeenCalled();
    expect(mockApi.appealQueue).not.toHaveBeenCalled();
  });

  it('арбитру: пустая очередь → честное пустое состояние', async () => {
    signInAsArbitrator();
    mockApi.disputeQueue.mockResolvedValue({ items: [] });
    mockApi.appealQueue.mockResolvedValue({ items: [] });
    const { findByText } = renderScreen();
    expect(await findByText('Очередь пуста')).toBeTruthy();
  });

  it('арбитру: кейсы в очереди → карточки', async () => {
    signInAsArbitrator();
    const party = (id: string, role: string) => ({
      id,
      displayName: `Участник ${id}`,
      role,
    });
    mockApi.disputeQueue.mockResolvedValue({
      items: [
        {
          id: 'd-1',
          type: 'debt',
          referenceId: 'debt-1',
          subject: 'Долг: 10000 ₽',
          status: 'open',
          firstParty: party('u-b', 'buyer'),
          secondParty: party('u-s', 'seller'),
          openedBy: party('u-b', 'buyer'),
          openedAt: new Date('2026-11-07T08:00:00Z').toISOString(),
          assignedTo: null,
          assignedAt: null,
          resolution: null,
          resolvedAt: null,
          notes: null,
          messagesCount: 1,
          evidenceCount: 0,
        },
      ],
    });
    mockApi.appealQueue.mockResolvedValue({ items: [] });
    const { findByText } = renderScreen();
    expect(await findByText('Долг: 10000 ₽')).toBeTruthy();
    expect(await findByText('В работе: 1')).toBeTruthy();
  });
});

describe('«Арбитраж»: вкладка апелляций 289-ФЗ (ADR-035)', () => {
  beforeEach(() => {
    mockApi.disputeQueue.mockReset();
    mockApi.appealQueue.mockReset();
  });

  /** Валидная апелляция для мока API. */
  function makeAppeal() {
    const party = (id: string, role: string) => ({
      id,
      displayName: `Участник ${id}`,
      role,
    });
    return {
      id: 'a-1',
      blockedPairId: 'block-1',
      driver: party('u-d', 'driver'),
      seller: party('u-s', 'seller'),
      appellant: party('u-d', 'driver'),
      reason: 'Часы задвоились из-за отменённых доставок',
      status: 'open' as const,
      openedAt: new Date('2026-11-07T08:00:00Z').toISOString(),
      assignedTo: null,
      assignedAt: null,
      resolvedAt: null,
      notes: null,
    };
  }

  it('пустая очередь апелляций → честное пустое состояние', async () => {
    signInAsArbitrator();
    mockApi.disputeQueue.mockResolvedValue({ items: [] });
    mockApi.appealQueue.mockResolvedValue({ items: [] });
    const { findByText } = renderScreen();

    // Переключаемся на вкладку апелляций.
    fireEvent.press(await findByText('Апелляции 289-ФЗ'));
    expect(await findByText('Апелляций нет')).toBeTruthy();
  });

  it('апелляция в очереди → карточка пары с жалобой', async () => {
    signInAsArbitrator();
    mockApi.disputeQueue.mockResolvedValue({ items: [] });
    mockApi.appealQueue.mockResolvedValue({ items: [makeAppeal()] });
    const { findByText } = renderScreen();

    fireEvent.press(await findByText('Апелляции 289-ФЗ'));
    expect(await findByText(/Часы задвоились/)).toBeTruthy();
    expect(await findByText('В работе: 1')).toBeTruthy();
  });
});
