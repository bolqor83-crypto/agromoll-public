/**
 * QR для native (v0.5.0, ADR-015): react-native-qrcode-svg — реальный
 * сканируемый код для expo-camera на другой стороне.
 */
import QRCodeSvg from 'react-native-qrcode-svg';
import { View } from 'react-native';
import { spacing, Text } from '@agromoll/ui';
import type { QrCodeProps } from './types';

export default function QrCode({ value, size = 180, caption }: QrCodeProps) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <View
        style={{
          padding: spacing.md,
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
        }}
      >
        <QRCodeSvg value={value} size={size} backgroundColor="white" color="#1F2933" />
      </View>
      {caption ? (
        <Text variant="caption" color="secondary" align="center">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
