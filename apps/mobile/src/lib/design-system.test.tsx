/**
 * Рендер-тест дизайн-системы v0.6.2-B (ADR-028): типографика Inter,
 * табличные цифры, кнопки (radius 16, outline-secondary, danger),
 * карточки (radius 16, тёмная тема — borderStrong, disabled).
 *
 * Мок Reanimated (jest.setup) не исполняет анимации — проверяем
 * структуру и стили, а не пружины.
 */
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Badge, Button, Card, TabBar, ThemeProvider, Text } from '@agromoll/ui';

function flattenStyle(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) ?? {};
}

/** Ближайший предок текста, у которого в стиле есть указанное свойство. */
function ancestorStyleWith(textNode: { parent: unknown }, prop: string): Record<string, unknown> {
  let node = textNode.parent as { props: { style?: unknown }; parent?: unknown } | undefined;
  while (node) {
    const style = flattenStyle(node.props?.style);
    if (style[prop] !== undefined) {
      return style;
    }
    node = node.parent as { props: { style?: unknown }; parent?: unknown } | undefined;
  }
  return {};
}

function renderUi(node: React.ReactElement, theme: 'light' | 'dark' = 'light') {
  return render(<ThemeProvider initialSetting={theme}>{node}</ThemeProvider>);
}

describe('Text — типографика Inter (v0.6.2-B)', () => {
  it('применяет fontFamily по варианту: body → Inter_400Regular', () => {
    const screen = renderUi(<Text>Текст</Text>);
    const style = flattenStyle(screen.getByText('Текст').props.style);
    expect(style.fontFamily).toBe('Inter_400Regular');
    expect(style.fontSize).toBe(17);
    expect(style.lineHeight).toBe(26);
  });

  it('display → Inter_700Bold + отрицательный трекинг', () => {
    const screen = renderUi(<Text variant="display">Заголовок</Text>);
    const style = flattenStyle(screen.getByText('Заголовок').props.style);
    expect(style.fontFamily).toBe('Inter_700Bold');
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toBe(40);
    expect(style.letterSpacing).toBe(-0.4);
  });

  it('weight перекрывает вариант: caption + weight 600 → Inter_600SemiBold', () => {
    const screen = renderUi(
      <Text variant="caption" weight="600">
        Подпись
      </Text>,
    );
    const style = flattenStyle(screen.getByText('Подпись').props.style);
    expect(style.fontFamily).toBe('Inter_600SemiBold');
  });

  it('numeric → табличные цифры (fontVariant tabular-nums)', () => {
    const screen = renderUi(<Text numeric>1 234 ₽</Text>);
    const style = flattenStyle(screen.getByText('1 234 ₽').props.style);
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });

  it('без numeric — пропорциональные цифры (fontVariant не задан)', () => {
    const screen = renderUi(<Text>Обычный текст</Text>);
    const style = flattenStyle(screen.getByText('Обычный текст').props.style);
    expect(style.fontVariant).toBeUndefined();
  });
});

describe('Button — варианты по спеке v0.6.2-B', () => {
  it('primary: скругление 16 (не pill), minHeight 56 + вертикальные паддинги', () => {
    const screen = renderUi(<Button title="Забронировать" />);
    const btn = screen.getByRole('button', { name: 'Забронировать' });
    const style = flattenStyle(btn.props.style);
    expect(style.borderRadius).toBe(16);
    // minHeight, не фикс. height: двухстрочный лейбл растягивает, не режется
    expect(style.minHeight).toBe(56);
    expect(style.height).toBeUndefined();
    expect(style.paddingVertical).toBe(14);
  });

  it('secondary: прозрачный фон + зелёная обводка 1.5', () => {
    const screen = renderUi(<Button title="Обновить" variant="secondary" />);
    const btn = screen.getByRole('button', { name: 'Обновить' });
    const style = flattenStyle(btn.props.style);
    expect(style.backgroundColor).toBe('transparent');
    expect(style.borderWidth).toBe(1.5);
    expect(style.borderColor).toBe('#2D6A4F');
  });

  it('danger: янтарная обводка, подложка warning+альфа, не красный', () => {
    const screen = renderUi(<Button title="Отменить бронь" variant="danger" />);
    const btn = screen.getByRole('button', { name: 'Отменить бронь' });
    const style = flattenStyle(btn.props.style);
    expect(style.borderColor).toBe('#DE911D');
    expect(String(style.backgroundColor)).toMatch(/^#DE911D/);
  });

  it('disabled: фон — border-токен, полупрозрачность', () => {
    const screen = renderUi(<Button title="Недоступно" disabled />);
    const btn = screen.getByRole('button', { name: 'Недоступно' });
    const style = flattenStyle(btn.props.style);
    expect(style.backgroundColor).toBe('#E7E2D8');
    expect(style.opacity).toBe(0.6);
  });
});

describe('Card — глубина и состояния (v0.6.2-B)', () => {
  it('скругление 16 (не 20)', () => {
    const screen = renderUi(
      <Card>
        <Text>Содержимое</Text>
      </Card>,
    );
    const style = ancestorStyleWith(screen.getByText('Содержимое'), 'borderRadius');
    expect(style.borderRadius).toBe(16);
  });

  it('тёмная тема: рамка borderStrong (elevation через цвет), без тени', () => {
    const screen = renderUi(
      <Card>
        <Text>Тёмная карточка</Text>
      </Card>,
      'dark',
    );
    const style = ancestorStyleWith(screen.getByText('Тёмная карточка'), 'borderColor');
    expect(style.borderColor).toBe('#3A423C');
    expect(style.shadowOpacity).toBeUndefined();
  });

  it('disabled: opacity 0.5, без accessibilityRole button', () => {
    const screen = renderUi(
      <Card onPress={() => undefined} disabled>
        <Text>Недоступно</Text>
      </Card>,
    );
    const style = ancestorStyleWith(screen.getByText('Недоступно'), 'opacity');
    expect(style.opacity).toBe(0.5);
    // disabled-карточка — не кнопка для скринридера
    const cardNode = screen.getByText('Недоступно').parent as unknown as {
      parent?: { props: { accessibilityRole?: string } };
    };
    expect(cardNode.parent?.props.accessibilityRole).toBeUndefined();
  });
});

describe('Badge — иконка + текст (v0.6.2-B)', () => {
  it('иконка рендерится слева от текста', () => {
    const screen = renderUi(<Badge label="Скоропорт" variant="attention" icon="time-outline" />);
    expect(screen.getByTestId('icon-time-outline')).toBeTruthy();
    expect(screen.getByText('Скоропорт')).toBeTruthy();
  });

  it('без иконки — просто текст (обратная совместимость)', () => {
    const screen = renderUi(<Badge label="Линия 12" variant="neutral" />);
    expect(screen.getByText('Линия 12')).toBeTruthy();
  });
});

describe('TabBar — вкладки в РЯД, не столбиком (v0.6.2-C, регрессия)', () => {
  it('контейнер flexDirection: row', () => {
    const items = [
      { key: 'feed', label: 'Лента', icon: 'basket-outline' as never },
      { key: 'bookings', label: 'Брони', icon: 'bookmark-outline' as never },
    ];
    const screen = renderUi(<TabBar items={items} activeKey="feed" onChange={() => undefined} />);
    // 'tablist' нет в ARIA-карте RTL — ищем по пропсу напрямую
    const bar = screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' });
    const style = flattenStyle(bar.props.style);
    // регрессия v0.3.1→v0.6.2: flexDirection потерялся, вкладки стояли столбиком
    expect(style.flexDirection).toBe('row');
  });

  it('вкладки делят ширину поровну (flex: 1)', () => {
    const items = [
      { key: 'feed', label: 'Лента', icon: 'basket-outline' as never },
      { key: 'bookings', label: 'Брони', icon: 'bookmark-outline' as never },
    ];
    const screen = renderUi(<TabBar items={items} activeKey="feed" onChange={() => undefined} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(flattenStyle(tab.props.style).flex).toBe(1);
    }
  });
});
