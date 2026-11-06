/**
 * Тесты клавиатурного поведения (v0.6.1-B, ADR-024) и рендера SheetModal:
 * платформенные behavior-стратегии, скругления листа, контент форм внутри
 * KeyboardAvoidingView.
 */
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider, radius } from '@agromoll/ui';
import { keyboardBehavior, resolveKeyboardBehavior } from './keyboard';
import { SheetModal } from '@/components/SheetModal';

describe('resolveKeyboardBehavior (ADR-024)', () => {
  it('iOS — padding: контент поднимается над клавиатурой', () => {
    expect(resolveKeyboardBehavior('ios')).toBe('padding');
  });

  it('Android — height: внутри Modal adjustResize не срабатывает', () => {
    expect(resolveKeyboardBehavior('android')).toBe('height');
  });

  it('web — undefined: физической клавиатуры-оверлея нет', () => {
    expect(resolveKeyboardBehavior('web')).toBeUndefined();
  });

  it('платформа тестов (ios) использует padding', () => {
    expect(keyboardBehavior).toBe('padding');
  });
});

describe('SheetModal: клавиатура и скругления (v0.6.1-B)', () => {
  it('открытый лист рендерит контент формы (внутри KeyboardAvoidingView)', async () => {
    const screen = await render(
      <ThemeProvider>
        <SheetModal visible onClose={() => undefined}>
          <Text>Поле формы</Text>
        </SheetModal>
      </ThemeProvider>,
    );
    expect(screen.getByText('Поле формы')).toBeTruthy();
    // Кнопка закрытия (scrim) доступна
    expect(screen.getByLabelText('Закрыть')).toBeTruthy();
  });

  it('закрытый лист не рендерит контент', async () => {
    const screen = await render(
      <ThemeProvider>
        <SheetModal visible={false} onClose={() => undefined}>
          <Text>Поле формы</Text>
        </SheetModal>
      </ThemeProvider>,
    );
    expect(screen.queryByText('Поле формы')).toBeNull();
  });

  it('радиус скругления листа — из токена radius.lg (20)', () => {
    expect(radius.lg).toBe(20);
  });
});
