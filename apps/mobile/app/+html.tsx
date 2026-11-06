/**
 * Кастомный HTML-корень web-версии (v0.6.1-C, ADR-025).
 *
 * 1. Фокус-стили для клавиатурной навигации: :focus-visible обводка
 *    зелёным акцентом — видно, где вы находитесь при работе с Tab.
 *    React Native Web не даёт стилизовать фокус из JS — только CSS.
 * 2. theme-color — цвет адресной строки браузера в тон бренда.
 * 3. v0.6.2-D (ADR-030): скроллбары web — тонкие, из токена borderStrong.
 *    Цвет приходит в CSS-переменной --agromoll-scrollbar, её обновляет
 *    ThemeProvider при смене темы (RN красить скроллбары не умеет).
 *
 * Нативные платформы этот файл не используют (только web-экспорт).
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import { palette } from '@agromoll/ui';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* брендовый цвет браузерного chrome — из токенов, не хардкодом */}
        <meta name="theme-color" content={palette.light.primary} />
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
    outline: 2px solid ${palette.light.accent};
    outline-offset: 2px;
  }
  div[role="button"]:focus:not(:focus-visible),
  a:focus:not(:focus-visible) {
    outline: none;
  }
  html, body {
    -webkit-tap-highlight-color: transparent;
  }
  /* v0.6.2-D: скроллбар из токенов — переменную обновляет ThemeProvider
     (значение по умолчанию — до первого рендера темы). */
  html {
    scrollbar-width: thin;
    scrollbar-color: var(--agromoll-scrollbar, ${palette.light.borderStrong}) transparent;
  }
  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: var(--agromoll-scrollbar, ${palette.light.borderStrong});
    border-radius: 999px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
`;
