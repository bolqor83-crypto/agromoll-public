/**
 * Источник «морфа» карточки → детальный экран (v0.3.1, ADR-009).
 *
 * Ручной shared-element переход: при нажатии карточка замеряет своё
 * положение на экране (measureInWindow) и кладёт фрейм в этот
 * singleton; детальный экран забирает фрейм (consume — одноразово)
 * и «вырастает» из него spring-анимацией. Никакой глобальной
 * инфраструктуры: два экрана и 60 строк кода (обоснование отказа
 * от react-native-screen-transitions — ADR-009).
 */

/** Прямоугольник на экране (координаты окна, px). */
export interface ScreenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Живут только на время перехода; окно ~1 с, утечек нет. */
const origins = new Map<string, ScreenFrame>();

/** Запомнить, откуда раскрывается экран (вызывает карточка при нажатии). */
export function recordTransitionOrigin(id: string, frame: ScreenFrame): void {
  origins.set(id, frame);
}

/** Забрать фрейм-источник (вызывает детальный экран; одноразово). */
export function consumeTransitionOrigin(id: string): ScreenFrame | null {
  const frame = origins.get(id) ?? null;
  origins.delete(id);
  return frame;
}
