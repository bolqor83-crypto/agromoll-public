/**
 * Экран «Сервер не настроен» (v0.6.1-0, ADR-022).
 *
 * Хотфикс прода: раньше сборка без EXPO_PUBLIC_API_URL молча ходила
 * на http://localhost:3000 и «оживала» только на машине разработчика.
 * Теперь в prod без адреса приложение честно объясняет, что произошло
 * и как это починить, — вместо молчаливых ошибок сети и фейкового
 * демо-режима.
 *
 * Философия (ADR-002): экран не пугает. Это не ошибка пользователя
 * и не сбой — просто сборка без сервера. Геометрическая иллюстрация
 * «сервер и несоединённый кабель», тёплые тона, понятные шаги.
 */
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { Badge, Card, radius, Screen, spacing, Text, useTheme } from '@agromoll/ui';

/** Шаги подключения сервера — для того, кто публикует сборку. */
const SETUP_STEPS = [
  'Поднять API публично — план в docs/DEPLOY.md репозитория.',
  'Задать адрес в переменной EXPO_PUBLIC_API_URL (Vercel → Project Settings → Environment Variables).',
  'Пересобрать деплой — адрес вшивается в бандл на сборке.',
] as const;

export function ApiNotConfiguredScreen() {
  return (
    <Screen scroll={false}>
      <View
        accessibilityLabel="Сервер не настроен"
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.lg,
          paddingHorizontal: spacing.xl,
        }}
      >
        <UnpluggedServerIllustration />

        <Badge label="Сборка без сервера" variant="attention" />

        <Text variant="title" align="center">
          Сервер не настроен
        </Text>
        <Text variant="body" color="secondary" align="center">
          Эта сборка опубликована без адреса API — вход и живые данные
          недоступны. Это не сбой сети: адрес задаётся при сборке
          приложения.
        </Text>

        <Card
          style={{
            width: '100%',
            maxWidth: 480,
            gap: spacing.md,
          }}
        >
          <Text variant="body" weight="600">
            Как подключить сервер
          </Text>
          {SETUP_STEPS.map((step, index) => (
            <View key={step} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Text variant="body" color="primary" weight="600">
                {index + 1}.
              </Text>
              <Text variant="caption" color="secondary" style={{ flex: 1, lineHeight: 19 }}>
                {step}
              </Text>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Иллюстрация: сервер (скруглённый корпус с «огоньками») и кабель,
 * который не дотягивается до розетки — честная метафора «нет адреса».
 * Только геометрия в токенах темы, никаких стоковых картинок (ADR-005).
 */
function UnpluggedServerIllustration() {
  const { colors } = useTheme();
  const led = (color: string): ReactElement => (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: color,
      }}
    />
  );
  return (
    <View style={{ alignItems: 'center', width: 120 }}>
      {/* Корпус сервера */}
      <View
        style={{
          width: 88,
          height: 64,
          borderRadius: radius.md,
          backgroundColor: colors.primaryMuted,
          borderWidth: 5,
          borderColor: colors.primary,
          justifyContent: 'center',
          alignItems: 'center',
          gap: spacing.md,
        }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.md }}>{led(colors.primary)}</View>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {led(colors.primary)}
          {led(colors.warning)}
        </View>
      </View>
      {/* Кабель: два сегмента с разрывом — «не подключено» */}
      <View
        style={{
          width: 6,
          height: 18,
          borderRadius: radius.pill,
          backgroundColor: colors.primary,
          marginTop: -2,
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 34,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.primary,
          }}
        />
        {/* Разрыв — вот чего не хватает до сервера */}
        <View
          style={{
            width: 14,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.warning,
          }}
        />
        <View
          style={{
            width: 34,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.border,
          }}
        />
      </View>
    </View>
  );
}
