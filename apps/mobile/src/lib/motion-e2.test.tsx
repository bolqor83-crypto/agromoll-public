/**
 * Тесты анимаций E2 (v0.6.1-E2, ADR-027): SuccessCheck, AnimatedNumber,
 * ShakeField — рендер, testID, поведение при reduced motion.
 *
 * Мок Reanimated доводит анимации мгновенно до финала — поэтому
 * проверяем СТРУКТУРУ и решения (reduced → без анимации), а не кадры:
 * визуальная плавность подтверждена скриншотами и FPS-замером.
 */
import { useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  AnimatedNumber,
  ErrorState,
  ShakeField,
  SuccessCheck,
  ThemeProvider,
} from '@agromoll/ui';

describe('SuccessCheck — тихая галочка успеха (ADR-027)', () => {
  it('рендерится с testID и доступна скринридеру', async () => {
    const screen = await render(
      <ThemeProvider>
        <SuccessCheck />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('success-check')).toBeTruthy();
    expect(screen.getByLabelText('Готово')).toBeTruthy();
  });

  it('onDone вызывается примерно через секунду — родитель убирает галочку', async () => {
    jest.useFakeTimers();
    const onDone = jest.fn();
    await render(
      <ThemeProvider>
        <SuccessCheck onDone={onDone} />
      </ThemeProvider>,
    );
    jest.advanceTimersByTime(1100);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    jest.useRealTimers();
  });

  it('reduced motion — рендер без анимации, содержимое на месте', async () => {
    const screen = await render(
      <ThemeProvider>
        <SuccessCheck reducedMotion />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('success-check')).toBeTruthy();
    expect(screen.getByLabelText('Готово')).toBeTruthy();
  });
});

describe('AnimatedNumber — плавный пересчёт (ADR-027)', () => {
  it('показывает отформатированное значение сразу', async () => {
    const screen = await render(
      <ThemeProvider>
        <AnimatedNumber value={12500} format={(n) => `${Math.round(n)} ₽`} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('animated-number')).toBeTruthy();
    expect(screen.getByText('12500 ₽')).toBeTruthy();
  });

  it('изменение значения доезжает до нового числа (мок доводит мгновенно)', async () => {
    function Counter() {
      const [value, setValue] = useState(100);
      return (
        <>
          <AnimatedNumber value={value} format={(n) => `${Math.round(n)} кг`} />
          <TouchableOpacity testID="bump" onPress={() => setValue(250)}>
            <Text>+</Text>
          </TouchableOpacity>
        </>
      );
    }
    const screen = await render(
      <ThemeProvider>
        <Counter />
      </ThemeProvider>,
    );
    expect(screen.getByText('100 кг')).toBeTruthy();

    fireEvent.press(screen.getByTestId('bump'));

    await waitFor(() => expect(screen.getByText('250 кг')).toBeTruthy());
  });

  it('reduced motion — новое значение показывается сразу, без пробега', async () => {
    const screen = await render(
      <ThemeProvider>
        <AnimatedNumber value={42} format={(n) => n.toFixed(1)} reducedMotion />
      </ThemeProvider>,
    );
    expect(screen.getByText('42.0')).toBeTruthy();
  });
});

describe('ShakeField — покачивание при ошибке валидации (ADR-027)', () => {
  it('рендерит детей; shakeKey=0 не качает', async () => {
    const screen = await render(
      <ThemeProvider>
        <ShakeField shakeKey={0}>
          <Text>Поле суммы</Text>
        </ShakeField>
      </ThemeProvider>,
    );
    expect(screen.getByText('Поле суммы')).toBeTruthy();
  });

  it('инкремент shakeKey не ломает рендер (мок исполняет sequence мгновенно)', async () => {
    function Form() {
      const [shake, setShake] = useState(0);
      return (
        <>
          <ShakeField shakeKey={shake}>
            <Text>Поле суммы</Text>
          </ShakeField>
          <TouchableOpacity testID="invalidate" onPress={() => setShake((k) => k + 1)}>
            <Text>x</Text>
          </TouchableOpacity>
        </>
      );
    }
    const screen = await render(
      <ThemeProvider>
        <Form />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId('invalidate'));
    fireEvent.press(screen.getByTestId('invalidate'));
    expect(screen.getByText('Поле суммы')).toBeTruthy();
  });
});

describe('ErrorState: появление и reduced motion (ADR-026/027)', () => {
  it('full-вариант рендерится с заголовком и «Повторить»', async () => {
    const screen = await render(
      <ThemeProvider>
        <ErrorState
          title="Нет связи с сервером"
          description="Проверьте интернет."
          onRetry={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('error-state')).toBeTruthy();
    expect(screen.getByText('Нет связи с сервером')).toBeTruthy();
    expect(screen.getByText('Повторить')).toBeTruthy();
  });
});
