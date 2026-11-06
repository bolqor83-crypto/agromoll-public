/**
 * Контракт сканера QR-подтверждения (v0.5.0, ADR-015).
 *
 * Native — камера (expo-camera), web — ручной ввод кода: платформа
 * выбирается расширением файла (как у карты, ADR-014).
 */
export interface QrScannerProps {
  /** Ожидаемый код (сравнивается с отсканированным/введённым). */
  expectedCode: string;
  /** Результат сверки: true — код совпал. */
  onResult: (matches: boolean) => void;
  /** Подпись-подсказка. */
  hint?: string;
}
