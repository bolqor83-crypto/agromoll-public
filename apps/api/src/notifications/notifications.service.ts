/**
 * Сервис уведомлений (v0.4.0 ADR-010 → v0.6.0-A ADR-031).
 *
 * Три канала, все «best-effort» — сбой доставки НЕ откатывает бизнес-операцию:
 *  1. In-app: строка в notifications — читается GET /notifications/me,
 *     прочитанные помечаются readAt. Это единственный гарантированный канал.
 *  2. Push FCM (native ios/android): DeviceToken-строки пользователя,
 *     FCM HTTP v1 (сервисный аккаунт). Без FCM_SERVICE_ACCOUNT_JSON — Noop.
 *  3. Web Push (браузеры): WebPushSubscription-строки, VAPID.
 *     Без VAPID_* — Noop.
 *
 * Push идёт через in-memory очередь с retry (экспоненциальная пауза,
 * максимум PUSH_MAX_ATTEMPTS попыток). Очередь живёт в процессе: падение
 * сервера теряет недоставленные push — осознанно, уведомление не стоит
 * внешнего брокера (ADR-031). Каждая доставка пишется в NotificationLog
 * (sent/failed) — по нему разбирают «не пришло».
 *
 * Сервис не бросает исключений наружу: уведомление — вспомогательный канал.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationLogListDto, NotificationType, UserRole } from '@agromoll/types';
import {
  DEFAULT_PUSH_RETRY_BASE_MS,
  FCM_SERVICE_ACCOUNT_JSON,
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_BASE_MS,
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
} from './notifications.constants';
import {
  FcmV1Transport,
  NoopPushTransport,
  WebPushTransport,
  type PushPayload,
  type PushResult,
  type PushTarget,
  type PushTransport,
} from './push-transports';

/** Входящее уведомление: тип + текст + контекст для перехода. */
export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Контекст: { debtId }, { bookingId } и т.п. */
  data?: Record<string, unknown>;
}

/** Плоский адресат одной доставки (для очереди: без ссылок на Prisma-типы). */
interface PendingDelivery {
  userId: string;
  channel: 'fcm' | 'web_push';
  target: PushTarget;
  payload: PushPayload;
  /** Номер попытки: 1..PUSH_MAX_ATTEMPTS. */
  attempt: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly push: PushTransport;
  private readonly webPush: PushTransport;
  private readonly retryBaseMs: number;
  private readonly vapidPublicKey: string | null;
  private pushDisabledLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Optional() @Inject(FCM_SERVICE_ACCOUNT_JSON) serviceAccount: string | undefined,
    @Optional() @Inject(PUSH_RETRY_BASE_MS) retryBaseMs: number | undefined,
  ) {
    this.push = serviceAccount ? this.createFcmTransport(serviceAccount) : new NoopPushTransport();
    this.vapidPublicKey = config.get<string>(VAPID_PUBLIC_KEY) ?? null;
    this.webPush = this.createWebPushTransport(config);
    const base = retryBaseMs ?? config.get<number>(PUSH_RETRY_BASE_MS);
    this.retryBaseMs =
      typeof base === 'number' && Number.isFinite(base) && base >= 0
        ? base
        : DEFAULT_PUSH_RETRY_BASE_MS;
  }

  /** FCM-транспорт создаётся отдельно: невалидный JSON аккаунта не должен
   * ронять приложение целиком — канал отключается с warn в лог. */
  private createFcmTransport(serviceAccount: string): PushTransport {
    try {
      return new FcmV1Transport(serviceAccount);
    } catch (error) {
      this.logger.warn(
        `FCM отключён: ${(error as Error).message}. Push на ios/android не отправляется.`,
      );
      return new NoopPushTransport();
    }
  }

  /** Web Push-транспорт: все три VAPID-переменные обязательны. */
  private createWebPushTransport(config: ConfigService): PushTransport {
    const publicKey = config.get<string>(VAPID_PUBLIC_KEY);
    const privateKey = config.get<string>(VAPID_PRIVATE_KEY);
    const subject = config.get<string>(VAPID_SUBJECT) ?? 'mailto:support@agromoll.local';
    if (!publicKey || !privateKey) {
      return new NoopPushTransport();
    }
    return new WebPushTransport(publicKey, privateKey, subject);
  }

  // ─── Отправка ─────────────────────────────────────────────────────────────

  /** In-app запись + push на все устройства пользователя. Ошибки не бросает. */
  async send(input: SendNotificationInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      });
      await this.pushToAllDevices(input);
    } catch (error) {
      // Уведомление не должно ломать бизнес-поток — только лог.
      this.logger.error({ err: error, input }, 'notifications:send failed');
    }
  }

  /**
   * Broadcast роли (ADR-031): «Новый заказ в вашем коридоре» всем водителям
   * и т.п. In-app каждому + push на все устройства каждого. Ошибки не бросает.
   */
  async sendToRole(role: UserRole, input: Omit<SendNotificationInput, 'userId'>): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { role },
        select: { id: true },
      });
      for (const user of users) {
        await this.send({ ...input, userId: user.id });
      }
      this.logger.log({ role, count: users.length }, 'notifications:broadcast');
    } catch (error) {
      this.logger.error({ err: error, role }, 'notifications:sendToRole failed');
    }
  }

  /** Собрать адресаты пользователя и поставить доставки в очередь. */
  private async pushToAllDevices(input: SendNotificationInput): Promise<void> {
    const [tokens, subscriptions] = await Promise.all([
      this.prisma.deviceToken.findMany({ where: { userId: input.userId } }),
      this.prisma.webPushSubscription.findMany({ where: { userId: input.userId } }),
    ]);
    if (tokens.length === 0 && subscriptions.length === 0) {
      if (
        !(this.push instanceof NoopPushTransport) &&
        !(this.webPush instanceof NoopPushTransport) &&
        !this.pushDisabledLogged
      ) {
        this.pushDisabledLogged = true;
        this.logger.warn('push не отправлен: у пользователя нет зарегистрированных устройств');
      }
      return;
    }
    const payload: PushPayload = {
      title: input.title,
      body: input.body,
      data: { type: input.type, ...(input.data ?? {}) },
    };
    for (const token of tokens) {
      void this.deliverWithRetry({
        userId: input.userId,
        channel: 'fcm',
        target: { kind: 'fcm', token: token.token },
        payload,
        attempt: 1,
      });
    }
    for (const sub of subscriptions) {
      void this.deliverWithRetry({
        userId: input.userId,
        channel: 'web_push',
        target: { kind: 'web_push', endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
        attempt: 1,
      });
    }
  }

  /**
   * Одна доставка с retry: попытка → при сбое пауза base·2^(attempt−1) и
   * повтор, до PUSH_MAX_ATTEMPTS. Итог каждой попытки — в NotificationLog
   * (последняя попытка определяет итоговый статус). Ошибки не бросает.
   */
  private async deliverWithRetry(delivery: PendingDelivery): Promise<void> {
    const transport = delivery.channel === 'fcm' ? this.push : this.webPush;
    let result: PushResult;
    try {
      result = await transport.send(delivery.target, delivery.payload);
    } catch (error) {
      // Транспорт обязан возвращать результат, но подстрахуемся.
      result = { ok: false, error: (error as Error).message };
    }
    await this.writeLog(delivery, result);

    if (result.ok) {
      // lastUsedAt — маркер живого токена (чистка неактивных в будущем).
      if (delivery.target.kind === 'fcm') {
        try {
          await this.prisma.deviceToken.updateMany({
            where: { token: delivery.target.token },
            data: { lastUsedAt: new Date() },
          });
        } catch {
          // best-effort: метрика живости не критична
        }
      }
      return;
    }
    if (delivery.attempt < PUSH_MAX_ATTEMPTS) {
      const delay = this.retryBaseMs * 2 ** (delivery.attempt - 1);
      setTimeout(() => {
        void this.deliverWithRetry({ ...delivery, attempt: delivery.attempt + 1 });
      }, delay);
      return;
    }
    // Все попытки исчерпаны: NotificationLog уже помечает failed — лог для ops.
    this.logger.warn(
      { channel: delivery.channel, attempts: delivery.attempt, error: result.error },
      'notifications:push failed после всех попыток',
    );
  }

  /** Журнал доставки: одна строка на итог попытки (sent/failed). */
  private async writeLog(delivery: PendingDelivery, result: PushResult): Promise<void> {
    try {
      await this.prisma.notificationLog.create({
        data: {
          userId: delivery.userId,
          channel: delivery.channel,
          title: delivery.payload.title,
          body: delivery.payload.body,
          status: result.ok ? 'sent' : 'failed',
          error: result.ok ? null : (result.error ?? 'unknown error').slice(0, 500),
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'notifications:log write failed');
    }
  }

  // ─── Регистрация устройств ────────────────────────────────────────────────

  /**
   * Регистрация FCM-токена (native). Идемпотентна: upsert по token —
   * повторный вызов с того же устройства обновляет userId (пользователь
   * перелогинился) и не плодит дубликаты.
   */
  async registerDeviceToken(
    userId: string,
    input: { platform: 'ios' | 'android'; token: string },
  ): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      create: { userId, token: input.token, platform: input.platform },
      update: { userId, platform: input.platform },
    });
    this.logger.log({ userId, platform: input.platform }, 'notifications:token registered');
  }

  /**
   * Регистрация Web Push-подписки. Идемпотентна: upsert по endpoint —
   * браузер при каждом запуске подписывается заново с тем же endpoint.
   */
  async registerWebPush(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string },
  ): Promise<void> {
    await this.prisma.webPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth },
      update: { userId, p256dh: input.p256dh, auth: input.auth },
    });
    this.logger.log({ userId }, 'notifications:web push subscribed');
  }

  /** Снятие регистрации (logout): токен/подписка отвязывается от пользователя. */
  async unregister(userId: string, input: { token?: string; endpoint?: string }): Promise<void> {
    if (input.token) {
      // deleteMany, а не delete: токен мог быть перерегистрирован другим
      // пользователем — удаляем только свою привязку.
      await this.prisma.deviceToken.deleteMany({ where: { token: input.token, userId } });
    }
    if (input.endpoint) {
      await this.prisma.webPushSubscription.deleteMany({
        where: { endpoint: input.endpoint, userId },
      });
    }
  }

  /** Публичный VAPID-ключ: браузер подписывается Web Push им. null — не настроен. */
  getVapidPublicKey(): string | null {
    return this.webPush instanceof NoopPushTransport ? null : this.vapidPublicKey;
  }

  // ─── Чтения ───────────────────────────────────────────────────────────────

  /** Мои уведомления (последние 100) + счётчик непрочитанных. */
  async findMine(userId: string) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  /** Пометить прочитанным. 404 если чужое/несуществующее — не отдаём. */
  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return updated.count > 0;
  }

  /** Журнал push-доставок (свои, последние 100) — отладка «не пришло». */
  async findLog(userId: string): Promise<NotificationLogListDto> {
    const items = await this.prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        channel: item.channel,
        title: item.title,
        body: item.body,
        status: item.status,
        error: item.error,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
}
