/**
 * Сканер QR для native (v0.5.0, ADR-015): expo-camera CameraView
 * со встроенным распознаванием штрихкодов. Результат сразу сверяется
 * с ожидаемым кодом доставки — без серверного раунда (UUID, ADR-015).
 */
import { useRef } from 'react';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Card, spacing, Text } from '@agromoll/ui';
import type { QrScannerProps } from './QrScanner.types';

export default function QrScanner({ expectedCode, onResult, hint }: QrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  if (!permission) {
    return (
      <Card>
        <Text variant="caption" color="secondary">
          Камера…
        </Text>
      </Card>
    );
  }

  if (!permission.granted) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <Text variant="body" color="secondary">
          Нужен доступ к камере, чтобы считать QR-код водителя.
        </Text>
        <Button title="Разрешить камеру" size="md" onPress={() => void requestPermission()} />
      </Card>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ height: 260, borderRadius: 16, overflow: 'hidden' }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(event) => {
            if (scannedRef.current) {
              return; // один результат за сессию сканирования
            }
            scannedRef.current = true;
            onResult(event.data === expectedCode);
          }}
        />
      </View>
      {hint ? (
        <Text variant="caption" color="secondary" align="center">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
