/**
 * Выбор и сжатие фото (v0.7.0-B, ADR-036/038).
 *
 * Одинаково работает на native и web: expo-image-picker на web
 * открывает input[type=file], expo-image-manipulator на web работает
 * через canvas. Фото сжимается ДО загрузки: макс 1200 px по длинной
 * стороне, JPEG 80 — трафик и хранилище не резиновые, а арбитру
 * достаточно разглядеть ящики/накладную.
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/** Максимум по длинной стороне после сжатия (px). */
export const PHOTO_MAX_SIDE = 1200;

/** Качество JPEG после сжатия (0…1). */
export const PHOTO_JPEG_QUALITY = 0.8;

/** Файл готовый к загрузке: байты + имя + MIME (после сжатия). */
export interface PreparedPhoto {
  bytes: Uint8Array;
  fileName: string;
  mimeType: 'image/jpeg';
  sizeBytes: number;
  /** Превью для UI ДО загрузки (uri сжатой копии): манипулятор уже
   *  вернул uri — не выбрасывать же его (v0.7.0-D). */
  previewUri: string;
}

/** Размер после сжатия всегда укладывается в fallback-лимит 500 КБ. */
export const FALLBACK_MAX_BYTES = 500 * 1024;

/**
 * Выбрать одно фото из галереи/камеры и сжать.
 * Отмена пользователем — null (не ошибка).
 */
export async function pickAndCompressPhoto(
  source: 'library' | 'camera' = 'library',
): Promise<PreparedPhoto | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: false,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  return compressPhoto(result.assets[0].uri);
}

/**
 * Выбрать НЕСКОЛЬКО фото из галереи и сжать каждое (v0.7.0-D, ADR-038):
 * фото товара грузятся пачкой — пять раз открывать галерею никто не будет.
 * selectionLimit ограничивает выбор ДО сжатия: больше лимита и не выбрать.
 * Отмена — пустой массив.
 */
export async function pickPhotosAndCompress(limit: number): Promise<PreparedPhoto[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, limit),
  });
  if (result.canceled) {
    return [];
  }
  return Promise.all(result.assets.map((asset) => compressPhoto(asset.uri)));
}

/** Сжать фото по uri: 1200 px / JPEG 80 (web — canvas, native — SDK). */
export async function compressPhoto(uri: string): Promise<PreparedPhoto> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE } }],
    // resize сохраняет пропорции: уменьшается только длинная сторона,
    // меньшая остаётся как есть (expo-image-manipulator semantics).
    { compress: PHOTO_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );

  const response = await fetch(manipulated.uri);
  const buffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    fileName: `photo-${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: buffer.byteLength,
    previewUri: manipulated.uri,
  };
}

/** Байты → data:-URL (fallback-путь, когда хранилище недоступно). */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunk = 0x8000; // 32k за шаг — стек String.fromCharCode не переполнить
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
