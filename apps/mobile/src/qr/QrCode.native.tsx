/**
 * QR для native (v0.5.0, ADR-015): react-native-qrcode-svg — реальный
 * сканируемый код для expo-camera на другой стороне.
 *
 * v0.6.2-D: цвета — из токенов светлой темы (не хардкодом). QR-стандарт
 * требует тёмные модули на светлом фоне — поэтому вне зависимости от
 * темы приложения берём light-палитру: код сканируется и днём, и ночью.
 */
import QRCodeSvg from 'react-native-qrcode-svg';
import { View } from 'react-native';
import { palette, spacing, Text } from '@agromoll/ui';
import type { QrCodeProps } from './types';

export default function QrCode({ value, size = 180, caption }: QrCodeProps) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <View
        style={{
          padding: spacing.md,
          backgroundColor: palette.light.surface,
          borderRadius: 16,
        }}
      >
        <QRCodeSvg
          value={value}
          size={size}
          backgroundColor={palette.light.surface}
          color={palette.light.text}
        />
      </View>
      {caption ? (
        <Text variant="caption" color="secondary" align="center">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
