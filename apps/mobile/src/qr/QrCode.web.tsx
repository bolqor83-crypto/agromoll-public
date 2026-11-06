/**
 * QR для web (v0.5.0, ADR-015): текстовый код подтверждения.
 *
 * На web камера-сканер ненадёжна (права браузера, углы наклона), а
 * SVG-библиотеки тянут зависимости, конфликтующие с expo export
 * (см. ADR-014). Тот же UUID показывается текстом — вводится
 * вручную на другой стороне; формат идентичен native.
 */
import { Pressable, View } from 'react-native';
import { Card, spacing, tap, Text } from '@agromoll/ui';
import type { QrCodeProps } from './types';

export default function QrCode({ value, size = 180, caption }: QrCodeProps) {
  const copy = (): void => {
    tap();
    void navigator.clipboard?.writeText(value).catch(() => undefined);
  };

  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <Card style={{ padding: spacing.lg, gap: spacing.xs }}>
        <Text variant="caption" color="secondary" align="center">
          Код подтверждения
        </Text>
        <Pressable accessibilityRole="button" onPress={copy} style={{ maxWidth: size * 1.6 }}>
          <Text variant="title" align="center" style={{ fontVariant: ['tabular-nums'] }}>
            {value}
          </Text>
        </Pressable>
        <Text variant="caption" color="muted" align="center">
          Тап — скопировать
        </Text>
      </Card>
      {caption ? (
        <Text variant="caption" color="secondary" align="center">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
