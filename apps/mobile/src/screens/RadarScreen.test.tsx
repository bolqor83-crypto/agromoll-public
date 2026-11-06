/**
 * Тесты рендера радара с ошибкой (v0.6.1-D, ADR-026, вариант A):
 * три сценария — INVALID_RESPONSE, network error, 500. Во всех
 * показывается ErrorState с кнопкой «Повторить», а не вечный
 * skeleton и не молчаливый console.warn.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/outbox', () => require('@/test/screen-mocks').createOutboxStoreMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());

// eslint-disable-next-line import/first -- моки должны объявиться до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import RadarScreen from './RadarScreen';

const mockApi = api as unknown as { deliveriesOpen: jest.Mock };

beforeEach(() => {
  mockApi.deliveriesOpen.mockReset();
});

function renderRadar() {
  return render(
    <ThemeProvider>
      <RadarScreen />
    </ThemeProvider>,
  );
}

describe('Радар с ошибкой — вариант A: честный ErrorState, без фейков', () => {
  it.each([
    ['INVALID_RESPONSE (сервер ответил мусором)', 'INVALID_RESPONSE'],
    ['network error (сети нет)', 'NETWORK'],
    ['500 (сервер упал)', 'SERVER'],
  ])('%s → ErrorState с «Повторить», не вечный skeleton', async (_label, code) => {
    mockApi.deliveriesOpen.mockRejectedValueOnce({
      message: `ошибка ${code}`,
      status: code === 'SERVER' ? 500 : undefined,
      code,
      body: undefined,
      hint: undefined,
    });

    const screen = renderRadar();

    // Фаза error наступила: унифицированный ErrorState на экране.
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });
    // Кнопка повтора видна и доступна.
    expect(screen.getByText('Повторить')).toBeTruthy();
    // Демо-заказов нет — радар не притворяется рабочим.
    expect(screen.queryByText('Беру')).toBeNull();
  });

  it('«Повторить» перезапускает загрузку, после восстановления — карточки', async () => {
    mockApi.deliveriesOpen
      .mockRejectedValueOnce({ message: 'нет сети', code: 'NETWORK', status: undefined, body: undefined, hint: undefined })
      .mockResolvedValueOnce([]);

    const screen = renderRadar();
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy(), { timeout: 3000 });

    fireEvent.press(screen.getByText('Повторить'));

    // Повтор ушёл и заверёнился пустым списком → пустое состояние, ошибка ушла.
    await waitFor(
      () => expect(screen.getByText('Попутных заказов нет')).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(mockApi.deliveriesOpen).toHaveBeenCalledTimes(2);
  });

  it('тексты ошибки человеческие: сеть — «Нет связи с сервером»', async () => {
    mockApi.deliveriesOpen.mockRejectedValueOnce({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });
    const screen = renderRadar();
    await waitFor(() => expect(screen.getByText('Нет связи с сервером')).toBeTruthy(), {
      timeout: 3000,
    });
  });
});
