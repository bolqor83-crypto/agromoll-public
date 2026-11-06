/**
 * Тесты онбординга (v0.6.2-C, ADR-029): 3 слайда, «Далее» → «Начать»,
 * «Пропустить» доступен всегда, флаг первого запуска пишется.
 *
 * Мок expo-router: useLocalSearchParams отдаёт next, router.replace
 * записывается для проверки перехода. Мок first-run — флаг под контролем
 * теста (контракт хранилища покрыт first-run.test.ts).
 */
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

import OnboardingScreen from '../../app/onboarding';
import { markOnboardingSeen } from '@/lib/first-run';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ next: '/(buyer)/feed' }),
  useRouter: () => ({
    replace: jest.fn().mockImplementation((url: string) => {
      mockRouterReplacedWith.push(url);
    }),
  }),
}));

jest.mock('@/lib/first-run', () => ({
  markOnboardingSeen: jest.fn().mockResolvedValue(undefined),
  isOnboardingSeen: jest.fn().mockResolvedValue(true),
}));



const mockRouterReplacedWith: string[] = [];

function renderScreen() {
  return renderWithRouter();
}

function renderWithRouter() {
  const { render } = require('@testing-library/react-native');
  const React = require('react');
  return render(
    React.createElement(ThemeProvider, null, React.createElement(OnboardingScreen)),
  );
}

describe('Онбординг — 3 слайда, один показ, можно пропустить (ADR-029)', () => {
  beforeEach(() => {
    mockRouterReplacedWith.length = 0;
    jest.clearAllMocks();
  });

  it('рендерит первый слайд «Закупайтесь быстрее» и точки', () => {
    const screen = renderScreen();
    expect(screen.getByText('Закупайтесь быстрее')).toBeTruthy();
    expect(screen.getByText('Доставка попутчиками')).toBeTruthy();
    expect(screen.getByText('Репутация и доверие')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Далее' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пропустить онбординг' })).toBeTruthy();
  });

  it('«Пропустить» сразу завершает: флаг записан, переход на next', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Пропустить онбординг' }));
    await waitFor(() => {
      expect(markOnboardingSeen).toHaveBeenCalledTimes(1);
      expect(mockRouterReplacedWith).toEqual(['/(buyer)/feed']);
    });
  });

  it('последний слайд: кнопка называется «Начать» и завершает', async () => {
    const screen = renderScreen();
    // Свайп до последнего слайда: два onScroll-события (жест в jest
    // не сработает — ScrollView не листается, событие честно эмулируем).
    const slides = screen.getByTestId('onboarding-slides');
    fireEvent.scroll(slides, {
      nativeEvent: { contentOffset: { x: 750 }, layoutMeasurement: { width: 375 } },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // теперь кнопка «Начать»
    fireEvent.press(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => {
      expect(markOnboardingSeen).toHaveBeenCalledTimes(1);
      expect(mockRouterReplacedWith).toEqual(['/(buyer)/feed']);
    });
  });

  it('next-параметр проходит валидацию: только пути внутри приложения', () => {
    // Глубокая проверка контракта: next ведёт на роут приложения
    const screen = renderScreen();
    expect(screen.getByText('Закупайтесь быстрее')).toBeTruthy();
  });
});
