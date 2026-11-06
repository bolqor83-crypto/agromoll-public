/**
 * Тесты EmptyState v0.6.2-C (ADR-029): живые idle-анимации и новый
 * грузовик. Reanimated замокан (jest.setup) — анимации не исполняются,
 * проверяем структуру: иллюстрация рендерится, у каждой — своя
 * idle-трансформация (функция idleTransform чистая и тестируемая).
 */
import { render } from '@testing-library/react-native';
import { ThemeProvider, EmptyState } from '@agromoll/ui';
const { idleTransformFor } = require('@agromoll/ui/src/components/EmptyState');

function renderEmpty(props: Partial<Parameters<typeof EmptyState>[0]>) {
  const React = require('react');
  return render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(EmptyState, {
        title: 'Тихо',
        description: 'Пока ничего нет',
        ...props,
      }),
    ),
  );
}

describe('EmptyState — живые иллюстрации (v0.6.2-C)', () => {
  it('рендерит заголовок, описание и кнопку действия', () => {
    const screen = renderEmpty({
      action: { label: 'Обновить', onPress: () => undefined },
    });
    expect(screen.getByText('Тихо')).toBeTruthy();
    expect(screen.getByText('Пока ничего нет')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeTruthy();
  });

  it('новая иллюстрация truck (доставки) рендерится', () => {
    const screen = renderEmpty({ illustration: 'truck' });
    expect(screen.getByText('Тихо')).toBeTruthy();
    // структура: не падаем на неизвестном kind
    expect(screen.toJSON()).toBeTruthy();
  });

  it('idle-трансформации: у каждого kind своя, амплитуда тихая', () => {
    // покачивание корзины: ±2°
    const basket0 = idleTransformFor('basket', 0);
    const basket1 = idleTransformFor('basket', 1);
    expect(basket0.transform[0].rotate).toBe('-2deg');
    expect(basket1.transform[0].rotate).toBe('2deg');
    // ящик дышит: 1 → 1.04
    expect(idleTransformFor('box', 0).transform[0].scale).toBe(1);
    expect(idleTransformFor('box', 1).transform[0].scale).toBeCloseTo(1.04);
    // радар: точка поднимается до 3px
    expect(idleTransformFor('radar', 1).transform[0].translateY).toBe(-3);
    // календарь плывёт ±2px
    expect(idleTransformFor('calendar', 0).transform[0].translateY).toBe(-2);
    expect(idleTransformFor('calendar', 1).transform[0].translateY).toBe(2);
    // грузовик катится ±5px с наклоном
    const truck0 = idleTransformFor('truck', 0);
    const truck1 = idleTransformFor('truck', 1);
    expect(truck0.transform[0].translateX).toBe(-5);
    expect(truck1.transform[0].translateX).toBe(5);
    expect(truck1.transform[1].rotate).toBe('0.8deg');
  });
});
