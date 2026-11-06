/**
 * QR-слой (v0.5.0, ADR-015): Metro выбирает платформу по расширению —
 * .native.tsx (react-native-qrcode-svg) / .web.tsx (текстовый код).
 * react-native-svg не попадает в web-бандл (экспорт на Vercel, D).
 */
export { default as QrCode } from './QrCode';
export type { QrCodeProps } from './types';

export { default as QrScanner } from './QrScanner';
export type { QrScannerProps } from './QrScanner.types';
