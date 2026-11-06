/**
 * Общие типы QR-слоя (v0.5.0, ADR-015).
 *
 * Платформенно-разделённая реализация: native — react-native-qrcode-svg
 * (через react-native-svg), web — текстовый код с копированием
 * (SVG-библиотеки конфликтуют с expo export, см. ADR-014 про карты).
 */
export interface QrCodeProps {
  /** Что кодировать: UUID подтверждения передачи. */
  value: string;
  /** Размер стороны, px. */
  size?: number;
  /** Подпись под кодом. */
  caption?: string;
}
