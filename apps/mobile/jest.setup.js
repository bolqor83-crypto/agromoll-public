/**
 * Jest setup (v0.6.1-A): мок react-native-reanimated для рендер-тестов.
 *
 * Worklets (анимации дизайн-системы) не исполняются в jest-expo —
 * рендер-тесты (RTL) проверяют структуру и доступность, а не анимации.
 * Мок официальный: react-native-reanimated/mock.
 */
// v0.6.1-E2: официальный мок не содержит useReducedMotion («ADD ME IF
// NEEDED» в исходнике) — добавляем: в тестах reduced motion выключен,
// отдельные тесты проверяют поведение через проп reducedMotion.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));

// v0.6.1-D: safe-area в jest. Нативный SafeAreaProvider не даёт insets
// без измерений — официальный мок библиотеки даёт нулевые insets и
// рендерит детей провайдера (иначе экраны с useSafeAreaInsets падают).
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// v0.6.1-D: Ionicons в jest. Реальный createIconSet требует загруженных
// шрифтов (expo-font) и падает в конструкторе isLoaded — в тестовом
// окружении шрифтов нет. Заглушка: имя иконки видно в testID (иконки
// в тестах не текст, а маркер структуры). Мокаем и точку входа пакета,
// и deep-импорт '@expo/vector-icons/Ionicons' (его использует Icon из ui).
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const MockIcon = (props) =>
    React.createElement(Text, {
      testID: `icon-${String(props.name ?? 'unknown')}`,
      accessibilityLabel: props.accessibilityLabel,
      accessibilityRole: props.accessibilityRole,
    });
  return { __esModule: true, Ionicons: MockIcon };
});

jest.mock('@expo/vector-icons/Ionicons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const MockIcon = (props) =>
    React.createElement(Text, {
      testID: `icon-${String(props.name ?? 'unknown')}`,
      accessibilityLabel: props.accessibilityLabel,
      accessibilityRole: props.accessibilityRole,
    });
  return { __esModule: true, default: MockIcon };
});
