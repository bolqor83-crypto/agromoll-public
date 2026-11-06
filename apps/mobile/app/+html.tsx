/* eslint-disable react/no-unknown-property */
/**
 * Кастомный HTML-корень web-версии (v0.6.1-C, ADR-025).
 *
 * 1. Фокус-стили для клавиатурной навигации: :focus-visible обводка
 *    зелёным акцентом — видно, где вы находитесь при работе с Tab.
 *    React Native Web не даёт стилизовать фокус из JS — только CSS.
 * 2. theme-color — цвет адресной строки браузера в тон бренда.
 *
 * Нативные платформы этот файл не используют (только web-экспорт).
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="theme-color" content="#2D6A4F" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: FOCUS_STYLES }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

/**
 * Фокус виден только при клавиатурной навигации (:focus-visible) —
 * тап/клик не подсвечивается (мобильный UX не трогаем).
 */
const FOCUS_STYLES = `
  :focus-visible {
    outline: 2px solid #40916C;
    outline-offset: 2px;
  }
  div[role="button"]:focus:not(:focus-visible),
  a:focus:not(:focus-visible) {
    outline: none;
  }
  html, body {
    -webkit-tap-highlight-color: transparent;
  }
`;
