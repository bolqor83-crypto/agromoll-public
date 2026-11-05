/**
 * Минимальный сервис уведомлений (v0.4.0, ADR-010).
 *
 * Две доставки, обе «best-effort»:
 *  1. In-app: строка в таблицу notifications — прочитывается
 *     GET /notifications/me, прочитанные помечаются readAt.
 *  2. Push через FCM (legacy HTTP API): только если у пользователя
 *     есть fcmToken И задан FCM_SERVER_KEY. Без ключа — тихий
 *     пропуск с одним warn-логом на старте (dev и CI работают
 *     без Firebase). Наружу — единый интерфейс, v0.4.0-C
 *     (уведомления приёмки) подключится к нему же.
 *
 * Сервис не бросает исключений: уведомление — вспомогательный канал,
 * сбой доставки не должен откатывать бизнес-операцию (напоминание
 * о долге пишется в журнал независимо).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationType } from '@agromoll/types';
import { FCM_SERVER_KEY } from './notifications.constants';

/** Входящее уведомление: тип + текст + контекст для перехода. */
export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Контекст: { debtId }, { bookingId } и т.п. */
  data?: Record<string, unknown>;
}

/** Push-транспорт: FCM в проде, заглушка в dev/CI. */
export interface PushTransport {
  /** Отправить push на токен устройства. Ошибки глотаются и логируются. */
  send(token: string, input: SendNotificationInput): Promise<void>;
}

/** Заглушка: push выключен (нет FCM_SERVER_KEY) — только in-app. */
export class NoopPushTransport implements PushTransport {
  send(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * FCM legacy HTTP API (https://fcm.googleapis.com/fcm/send).
 * Выбран вместо firebase-admin SDK осознанно: одна зависимость
 * (глобальный fetch Node 20), один ключ в ENV, без сервис-аккаунта
 * и файла учётных данных. Для MVP-объёмов уведомлений достаточно.
 */
export class FcmHttpTransport implements PushTransport {
  private static readonly ENDPOINT = 'https://fcm.googleapis.com/fcm/send';

  constructor(private readonly serverKey: string) {}

  async send(token: string, input: SendNotificationInput): Promise<void> {
    try {
      const response = await fetch(FcmHttpTransport.ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `key=${this.serverKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          notification: { title: input.title, body: input.body },
          data: input.data ?? {},
        }),
      });
      if (!response.ok) {
        throw new Error(`FCM ответил ${response.status}`);
      }
    } catch {
      // Push — вспомогательный канал: тихо логируем, не бросаем.
      // Подробный контекст пишет вызывающий код (logger сервиса).
    }
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly push: PushTransport;
  private pushDisabledLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(FCM_SERVER_KEY) serverKey: string | undefined,
  ) {
    this.push = serverKey ? new FcmHttpTransport(serverKey) : new NoopPushTransport();
  }

  /** In-app запись + push (если есть токен и ключ). Ошибки не бросает. */
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

      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { fcmToken: true },
      });
      if (user?.fcmToken) {
        await this.push.send(user.fcmToken, input);
      } else if (!(this.push instanceof NoopPushTransport) && !this.pushDisabledLogged) {
        this.pushDisabledLogged = true;
        this.logger.warn('push не отправлен: у пользователя нет fcmToken');
      }
    } catch (error) {
      // Уведомление не должно ломать бизнес-поток — только лог.
      this.logger.error({ err: error, input }, 'notifications:send failed');
    }
  }

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
}
