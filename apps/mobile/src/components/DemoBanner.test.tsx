/**
 * Тесты DemoBanner (v0.6.1-D, ADR-026, вариант B): демо-режим виден
 * с первого взгляда — баннер с текстом «Демо-режим. API недоступен.
 * Данные не настоящие», доступен скринридеру (alert).
 */
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';
import { DemoBanner } from './DemoBanner';

function renderBanner(props: Parameters<typeof DemoBanner>[0]) {
  return render(
    <ThemeProvider>
      <DemoBanner {...props} />
    </ThemeProvider>,
  );
}

describe('DemoBanner — честная маркировка демо-данных', () => {
  it('показывает «Демо-режим» и «API недоступен. Данные не настоящие»', () => {
    const screen = renderBanner({});
    expect(screen.getByText('Демо-режим')).toBeTruthy();
    expect(screen.getByText(/API недоступен\. Данные не настоящие/)).toBeTruthy();
  });

  it('testID и роль alert — баннер замечают и скринридер, и тесты', () => {
    const screen = renderBanner({});
    expect(screen.getByTestId('demo-banner')).toBeTruthy();
    expect(
      screen.getByLabelText(/Демо-режим: API недоступен, данные не настоящие/),
    ).toBeTruthy();
  });

  it('подсказка об отключённых кнопках выводится в баннер', () => {
    const screen = renderBanner({ hint: 'Рядом со мной отключён.' });
    expect(screen.getByText(/Рядом со мной отключён\./)).toBeTruthy();
  });

  it('без подсказки — стандартный текст про отключённые кнопки', () => {
    const screen = renderBanner({});
    expect(screen.getByText(/Кнопки, которым нужен сервер, отключены/)).toBeTruthy();
  });
});
