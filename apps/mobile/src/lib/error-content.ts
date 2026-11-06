/**
 * Маппинг ошибок API в человеческий текст (v0.6.1-D, ADR-026).
 *
 * Единый источник текстов для ErrorState: экраны не придумывают формулировки
 * на месте, а получают { title, description } по коду ApiError. Философия
 * (ADR-002): без технического жаргона («ECONNREFUSED», «500 Internal Server
 * Error»), без вины пользователя («вы сломали») — что случилось и что делать.
 */
import { ApiError, toApiError } from './api';

export interface ErrorContent {
  title: string;
  description: string;
}

const CONTENT_BY_CODE: Record<ApiError['code'], ErrorContent> = {
  NETWORK: {
    title: 'Нет связи с сервером',
    description:
      'Проверьте интернет. Всё, что вы сделали без сети, сохранится на телефоне и уйдёт на сервер, когда связь вернётся.',
  },
  TIMEOUT: {
    title: 'Сервер не отвечает',
    description: 'Запрос длился слишком долго. Попробуйте ещё раз.',
  },
  INVALID_RESPONSE: {
    title: 'Данные пришли в неожиданном виде',
    description:
      'Сервер ответил не так, как ожидает приложение. Мы записали это в журнал — попробуйте обновить ещё раз.',
  },
  RATE_LIMITED: {
    title: 'Слишком часто',
    description: 'Немного подождите — и попробуйте снова.',
  },
  SERVER: {
    title: 'Сервер перегружен',
    description: 'Мы уже знаем и разбираемся. Попробуйте ещё раз через минуту.',
  },
  UNAUTHORIZED: {
    title: 'Сессия истекла',
    description: 'Войдите снова — ваши данные не потеряются.',
  },
  UNKNOWN: {
    title: 'Не получилось загрузить',
    description: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
};

/**
 * Текст для ErrorState по любой ошибке: ApiError → свой код,
 * всё остальное → UNKNOWN. Серверная подсказка (hint) не подставляется:
 * наши формулировки мягче и единообразнее, сырой текст сервера уходит в лог.
 */
export function errorContentFor(error: unknown): ErrorContent {
  const apiError = toApiError(error);
  return CONTENT_BY_CODE[apiError.code] ?? CONTENT_BY_CODE.UNKNOWN;
}
