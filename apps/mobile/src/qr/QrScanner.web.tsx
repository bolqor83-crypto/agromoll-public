/**
 * Сканер QR для web (v0.5.0, ADR-015): ручной ввод кода.
 *
 * Браузерная камера для сканирования ненадёжна (права, наклон,
 * фокус), а expo-camera на web тянет getUserMedia-бандл — на web
 * проще сверить код вручную: формат тот же UUID (ADR-015).
 */
import { useState } from 'react';
import { Button, Card, Input, spacing, success, tap, Text, warning } from '@agromoll/ui';
import type { QrScannerProps } from './QrScanner.types';

export default function QrScanner({ expectedCode, onResult, hint }: QrScannerProps) {
  const [value, setValue] = useState('');

  const check = (): void => {
    tap();
    const matches = value.trim() === expectedCode;
    if (matches) {
      success();
    } else {
      warning();
    }
    onResult(matches);
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text variant="body" color="secondary">
        Введите код, который показывает водитель:
      </Text>
      <Input
        placeholder="UUID кода передачи"
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button title="Проверить код" size="md" disabled={value.trim().length === 0} onPress={check} />
      {hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}
