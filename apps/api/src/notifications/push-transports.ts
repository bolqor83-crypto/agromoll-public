/**
 * Push-транспорты (v0.6.0-A, ADR-031).
 *
 * Три реализации одного интерфейса:
 *  - FcmV1Transport — Firebase Cloud Messaging HTTP v1 (native ios/android).
 *    Аутентификация — OAuth2-токен по сервисному аккаунту (JWT RS256
 *    подписывается встроенным crypto Node, без firebase-admin SDK:
 *    ключ — FCM_SERVICE_ACCOUNT_JSON в ENV, зависимости меньше).
 *  - WebPushTransport — Web Push API (браузеры), VAPID + шифрование
 *    aes128gcm (RFC 8291) через библиотеку web-push: криптографию
 *    руками не пишем, проверенная реализация надёжнее.
 *  - NoopPushTransport — dev/CI: ключей нет, доставка «успешна» вхолостую,
 *    чтобы e2e-тесты проверяли журнал и in-app канал без Firebase.
 *
 * Транспорт ВОЗВРАЩАЕТ результат (не бросает): решение о retry принимает
 * очередь в NotificationsService.
 */
import { createSign } from 'node:crypto';
import webpush from 'web-push';

/** Адресат push-отправки: FCM-токен устройства или веб-подписка. */
export type PushTarget =
  | { kind: 'fcm'; token: string }
  | { kind: 'web_push'; endpoint: string; p256dh: string; auth: string };

/** Содержимое push-уведомления. */
export interface PushPayload {
  title: string;
  body: string;
  /** Контекст для перехода по тапу: { bookingId }, { deliveryId }… */
  data?: Record<string, unknown>;
}

/** Результат попытки доставки push на один адрес. */
export interface PushResult {
  ok: boolean;
  /** Человекочитаемая ошибка для NotificationLog.error. */
  error?: string;
}

/** Push-транспорт: отправка на один адрес. Никогда не бросает. */
export interface PushTransport {
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

/** Заглушка: push выключен (нет ключей) — доставка «успешна» вхолостую. */
export class NoopPushTransport implements PushTransport {
  send(): Promise<PushResult> {
    return Promise.resolve({ ok: true });
  }
}

/** Минимальные поля сервисного аккаунта Firebase (остальные не нужны). */
interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/** Часы для тестов: позволяют замокать Date.now. */
export interface Clock {
  now(): number;
}

const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/**
 * FCM HTTP v1: POST https://fcm.googleapis.com/v1/projects/{id}/messages:send
 *
 * Access-токен получается JWT-флоу OAuth2 (grant_type=jwt-bearer) и
 * кэшируется до истечения (минус 60 c запаса). Один сервисный аккаунт
 * на инстанс — токен общий для всех отправок.
 */
export class FcmV1Transport implements PushTransport {
  private static readonly SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
  private readonly account: ServiceAccount;
  private readonly clock: Clock;
  /** Кэш access-токена: { token, expiresAtMs }. */
  private cached: { token: string; expiresAtMs: number } | null = null;

  constructor(serviceAccountJson: string, clock: Clock = SYSTEM_CLOCK) {
    this.account = FcmV1Transport.parseAccount(serviceAccountJson);
    this.clock = clock;
  }

  /** base64 или чистый JSON сервисного аккаунта (base64 удобнее для ENV). */
  private static parseAccount(raw: string): ServiceAccount {
    let text = raw.trim();
    if (!text.startsWith('{')) {
      // ENV может содержать base64 (многострочный JSON в переменных
      // окружения неудобен) — пробуем декодировать.
      text = Buffer.from(text, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(text) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      throw new Error('FCM_SERVICE_ACCOUNT_JSON: нужны client_email, private_key, project_id');
    }
    return parsed as ServiceAccount;
  }

  /** JWT RS256 (header.payload.signature) для OAuth2 jwt-bearer. */
  private signJwt(): string {
    const nowSec = Math.floor(this.clock.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.account.client_email,
      scope: FcmV1Transport.SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    };
    const encoded = `${b64urlJson(header)}.${b64urlJson(claims)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(encoded);
    const signature = signer.sign(this.account.private_key);
    return `${encoded}.${signature.toString('base64url')}`;
  }

  /** OAuth2 access-токен с кэшем (перевыпуск за 60 с до истечения). */
  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs > this.clock.now() + 60_000) {
      return this.cached.token;
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.signJwt(),
      }),
    });
    if (!response.ok) {
      throw new Error(`OAuth2 ответил ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.cached = {
      token: payload.access_token,
      expiresAtMs: this.clock.now() + payload.expires_in * 1000,
    };
    return payload.access_token;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (target.kind !== 'fcm') {
      return { ok: false, error: 'FCM-транспорт принимает только FCM-токены' };
    }
    try {
      const token = await this.accessToken();
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: target.token,
              notification: { title: payload.title, body: payload.body },
              data: stringifyData(payload.data),
            },
          }),
        },
      );
      if (!response.ok) {
        return { ok: false, error: `FCM ответил ${response.status}: ${await response.text()}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `FCM: ${(error as Error).message}` };
    }
  }
}

/** Web Push (VAPID): библиотека web-push — шифрование RFC 8291. */
export class WebPushTransport implements PushTransport {
  private readonly options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
  };

  constructor(
    publicKey: string,
    privateKey: string,
    subject: string,
    private readonly sender: typeof webpush = webpush,
  ) {
    this.options = { vapidDetails: { subject, publicKey, privateKey } };
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (target.kind !== 'web_push') {
      return { ok: false, error: 'Web Push-транспорт принимает только подписки' };
    }
    try {
      await this.sender.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify({ title: payload.title, body: payload.body, data: payload.data }),
        this.options,
      );
      return { ok: true };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      const body = (error as { body?: string }).body;
      return {
        ok: false,
        error: `Web Push ${status ?? ''}: ${body ?? (error as Error).message}`.trim(),
      };
    }
  }
}

/** JSON → base64url без padding (для JWT). */
function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** FCM data-поля — только строки: приведение значений к string. */
function stringifyData(data?: Record<string, unknown>): Record<string, string> {
  if (!data) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = value === null || value === undefined ? '' : String(value);
  }
  return result;
}
