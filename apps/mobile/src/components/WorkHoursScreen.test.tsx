/**
 * Тесты «Мои часы» (v0.6.0-E, ADR-035): заблокированная пара без апелляции
 * предлагает «Оспорить блокировку»; активная апелляция — бейдж статуса
 * вместо кнопки (повторно подать нельзя, кейс уже в арбитраже).
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
import { WorkHoursScreen } from '@/components/WorkHoursScreen';
/* eslint-enable import/first */

const mockApi = api as unknown as {
  workHoursMine: jest.Mock;
  workHoursOpenSession: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <WorkHoursScreen />
    </ThemeProvider>,
  );
}

/** Водитель в сторе (экран часов: driver видит «Мои часы»). */
function signInAsDriver(): void {
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: 'u-driver',
      role: 'driver',
      displayName: 'Водитель',
      phone: '+79610000002',
      phoneVerified: true,
      totalConfirmations: 0,
      totalDisputes: 0,
      createdAt: new Date().toISOString(),
    },
    signOutNotice: null,
  });
}

/** Заблокированная пара (289-ФЗ) для мока API. */
function makeBlockedPair(overrides: Record<string, unknown> = {}) {
  return {
    counterpartId: 'u-seller',
    counterpartName: 'ФХ «Донская долина»',
    month: '2026-11',
    totalMinutes: 3600,
    monthCounted: true,
    series: 6,
    blocked: true,
    blockedPairId: 'block-1',
    appeal: null,
    activeSessionId: null,
    ...overrides,
  };
}

describe('«Мои часы»: обжалование блокировки (ADR-035)', () => {
  beforeEach(() => {
    mockApi.workHoursMine.mockReset();
    mockApi.workHoursOpenSession.mockReset();
    mockApi.workHoursOpenSession.mockResolvedValue(null);
  });

  it('заблокированная пара без апелляции → кнопка «Оспорить блокировку»', async () => {
    signInAsDriver();
    mockApi.workHoursMine.mockResolvedValue([makeBlockedPair()]);

    const { findByText } = renderScreen();
    expect(await findByText('Пауза по 289-ФЗ')).toBeTruthy();
    expect(await findByText('Оспорить блокировку')).toBeTruthy();
  });

  it('нажатие открывает шторку обжалования с разъяснением', async () => {
    signInAsDriver();
    mockApi.workHoursMine.mockResolvedValue([makeBlockedPair()]);

    const { findByText } = renderScreen();
    fireEvent.press(await findByText('Оспорить блокировку'));

    // Шторка: заголовок и мягкое разъяснение про 289-ФЗ.
    expect(await findByText(/приостановлена по 289-ФЗ/)).toBeTruthy();
    expect(await findByText('Что случилось (минимум 10 символов)')).toBeTruthy();
  });

  it('активная апелляция → бейдж статуса, кнопки обжалования нет', async () => {
    signInAsDriver();
    mockApi.workHoursMine.mockResolvedValue([
      makeBlockedPair({ appeal: { id: 'a-1', status: 'open' } }),
    ]);

    const { findByText, queryByText } = renderScreen();
    expect(await findByText('Апелляция: Открыта · переписка')).toBeTruthy();
    // Повторно подать нельзя — кейс уже в арбитраже.
    expect(queryByText('Оспорить блокировку')).toBeNull();
  });

  it('незаблокированная пара → без кнопки обжалования', async () => {
    signInAsDriver();
    mockApi.workHoursMine.mockResolvedValue([
      makeBlockedPair({
        blocked: false,
        blockedPairId: null,
        totalMinutes: 180,
        monthCounted: false,
        series: 1,
      }),
    ]);

    const { findByText, queryByText } = renderScreen();
    // Экран жив: пара отрисована, кнопки обжалования нет.
    expect(await findByText('ФХ «Донская долина»')).toBeTruthy();
    expect(queryByText('Оспорить блокировку')).toBeNull();
  });
});
