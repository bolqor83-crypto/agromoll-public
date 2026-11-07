/**
 * Unit-тесты NotificationsService (v0.6.0-A, ADR-031).
 *
 * Покрывают:
 *  - выбор канала: FCM-токены → fcm, веб-подписки → web_push, оба сразу;
 *  - retry: транспорт падает → пауза (экспоненциальная) → повтор,
 *    максимум PUSH_MAX_ATTEMPTS попыток, итог — failed в журнале;
 *  - успешная доставка: sent в журнале, lastUsedAt обновлён;
 *  - register/unregister: upsert по token/endpoint (идемпотентность,
 *    перепривязка токена к новому пользователю);
 *  - sendToRole: broadcast всем пользователям роли;
 *  - send: сбой push не бросает исключение (best-effort канал).
 *
 * Транспорты мокаются целиком: реальная доставка в unit-тестах не нужна.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { PUSH_MAX_ATTEMPTS } from './notifications.constants';
import type { PushResult, PushTarget, PushTransport } from './push-transports';

/** Мок Prisma: только методы, которые трогает сервис. */
function makePrisma() {
  return {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationLog: { create: jest.fn(), findMany: jest.fn() },
    deviceToken: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    webPushSubscription: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn() },
  } as unknown as PrismaService;
}

/** Транспорт с запрограммированной последовательностью результатов. */
class ScriptedTransport implements PushTransport {
  public calls: Array<{ target: PushTarget; title: string }> = [];
  constructor(private readonly script: PushResult[]) {}

  async send(target: PushTarget, payload: { title: string }): Promise<PushResult> {
    this.calls.push({ target, title: payload.title });
    const next = this.script.shift();
    return next ?? { ok: true };
  }
}

/** ConfigService-мок: без VAPID (web_push → Noop при прямом создании). */
function makeConfig(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

/** Создать сервис с подменёнными транспортами (в обход ENV-логики). */
function makeService(
  prisma: PrismaService,
  options: { fcm?: PushTransport; web?: PushTransport; retryBaseMs?: number } = {},
): NotificationsService {
  const service = new NotificationsService(
    prisma,
    makeConfig(),
    undefined, // без FCM_SERVICE_ACCOUNT_JSON
    options.retryBaseMs ?? 0, // паузы 0 мс — retry мгновенный
  );
  // Транспорты приватные: подменяем через any в тесте (единица под тестом —
  // логика очереди/каналов, не конструирование транспортов).
  const internals = service as unknown as {
    push: PushTransport;
    webPush: PushTransport;
  };
  internals.push = options.fcm ?? new ScriptedTransport([{ ok: true }]);
  internals.webPush = options.web ?? new ScriptedTransport([{ ok: true }]);
  return service;
}

const USER_ID = 'user-1';
const INPUT = {
  userId: USER_ID,
  type: 'booking_confirmed' as const,
  title: 'Бронь подтверждена',
  body: 'Продавец подтвердил вашу бронь.',
  data: { bookingId: 'booking-42' },
};

describe('NotificationsService (unit, ADR-031)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('send: выбор каналов', () => {
    it('FCM-токен → канал fcm, data.type прокинут в payload', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
        { userId: USER_ID, token: 'fcm-token-a', platform: 'ios' },
      ]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      const fcm = new ScriptedTransport([{ ok: true }]);
      const service = makeService(prisma, { fcm });

      await service.send(INPUT);

      expect(fcm.calls).toHaveLength(1);
      expect(fcm.calls[0].target).toEqual({ kind: 'fcm', token: 'fcm-token-a' });
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: 'fcm', status: 'sent' }),
        }),
      );
    });

    it('веб-подписка → канал web_push с ключами шифрования', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          userId: USER_ID,
          endpoint: 'https://push.example/sub/1',
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      ]);
      const web = new ScriptedTransport([{ ok: true }]);
      const service = makeService(prisma, { web });

      await service.send(INPUT);

      expect(web.calls).toHaveLength(1);
      expect(web.calls[0].target).toEqual({
        kind: 'web_push',
        endpoint: 'https://push.example/sub/1',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      });
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: 'web_push', status: 'sent' }),
        }),
      );
    });

    it('нет устройств — только in-app, без записей в журнал', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      const service = makeService(prisma);

      await service.send(INPUT);

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('in-app записывается даже при полном отказе push (best-effort)', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
        { userId: USER_ID, token: 'fcm-token-a', platform: 'android' },
      ]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.notificationLog.create as jest.Mock).mockRejectedValue(new Error('db down'));
      const failing = new ScriptedTransport([]);
      failing.send = jest.fn().mockRejectedValue(new Error('network'));
      const service = makeService(prisma, { fcm: failing });

      // Не бросает: сбой вспомогательного канала не ломает бизнес-поток.
      await expect(service.send(INPUT)).resolves.toBeUndefined();
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry-очередь', () => {
    it('сбой → retry до PUSH_MAX_ATTEMPTS, затем failed в журнале', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
        { userId: USER_ID, token: 'fcm-token-a', platform: 'ios' },
      ]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      const flaky = new ScriptedTransport([
        { ok: false, error: 'timeout 1' },
        { ok: false, error: 'timeout 2' },
        { ok: false, error: 'timeout 3' },
      ]);
      const service = makeService(prisma, { fcm: flaky, retryBaseMs: 0 });

      await service.send(INPUT);
      // retryBaseMs=0: setTimeout(0) — ждём микротаски + таймеры.
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(flaky.calls).toHaveLength(PUSH_MAX_ATTEMPTS);
      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(PUSH_MAX_ATTEMPTS);
      // Последняя запись — failed с ошибкой.
      const lastCall = (prisma.notificationLog.create as jest.Mock).mock.calls.at(-1)[0];
      expect(lastCall.data).toMatchObject({ status: 'failed', error: 'timeout 3' });
    });

    it('вторая попытка успешна — sent, third call нет', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
        { userId: USER_ID, token: 'fcm-token-a', platform: 'ios' },
      ]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      const flaky = new ScriptedTransport([{ ok: false, error: 'timeout' }, { ok: true }]);
      const service = makeService(prisma, { fcm: flaky, retryBaseMs: 0 });

      await service.send(INPUT);
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(flaky.calls).toHaveLength(2);
      const lastCall = (prisma.notificationLog.create as jest.Mock).mock.calls.at(-1)[0];
      expect(lastCall.data).toMatchObject({ status: 'sent' });
    });

    it('успех обновляет lastUsedAt токена', async () => {
      const prisma = makePrisma();
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
        { userId: USER_ID, token: 'fcm-token-a', platform: 'ios' },
      ]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      const service = makeService(prisma, { retryBaseMs: 0 });

      await service.send(INPUT);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(prisma.deviceToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { token: 'fcm-token-a' } }),
      );
    });
  });

  describe('register / unregister', () => {
    it('register FCM: upsert по token (идемпотентность)', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await service.registerDeviceToken(USER_ID, { platform: 'ios', token: 'tok-1' });
      await service.registerDeviceToken(USER_ID, { platform: 'ios', token: 'tok-1' });

      expect(prisma.deviceToken.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'tok-1' },
        create: { userId: USER_ID, token: 'tok-1', platform: 'ios' },
        update: { userId: USER_ID, platform: 'ios' },
      });
    });

    it('register web push: upsert по endpoint с обновлением ключей', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await service.registerWebPush(USER_ID, {
        endpoint: 'https://push.example/e1',
        p256dh: 'key-1',
        auth: 'auth-1',
      });

      expect(prisma.webPushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example/e1' },
        create: {
          userId: USER_ID,
          endpoint: 'https://push.example/e1',
          p256dh: 'key-1',
          auth: 'auth-1',
        },
        update: { userId: USER_ID, p256dh: 'key-1', auth: 'auth-1' },
      });
    });

    it('unregister удаляет только привязку своего пользователя', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await service.unregister(USER_ID, { token: 'tok-1', endpoint: 'https://push.example/e1' });

      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'tok-1', userId: USER_ID },
      });
      expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example/e1', userId: USER_ID },
      });
    });
  });

  describe('sendToRole', () => {
    it('broadcast: in-app + push каждому пользователю роли', async () => {
      const prisma = makePrisma();
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'driver-1' },
        { id: 'driver-2' },
      ]);
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.webPushSubscription.findMany as jest.Mock).mockResolvedValue([]);
      const service = makeService(prisma);

      await service.sendToRole('driver', {
        type: 'delivery_cancelled',
        title: 'Новый заказ',
        body: 'В вашем коридоре новый заказ.',
      });

      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'driver-2' }),
        }),
      );
    });
  });

  describe('журнал доставок', () => {
    it('findLog: сериализация дат в ISO', async () => {
      const prisma = makePrisma();
      const createdAt = new Date('2026-11-09T10:00:00Z');
      (prisma.notificationLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          userId: USER_ID,
          channel: 'fcm',
          title: 't',
          body: 'b',
          status: 'sent',
          error: null,
          createdAt,
        },
      ]);
      const service = makeService(prisma);

      const result = await service.findLog(USER_ID);

      expect(result.items[0]).toMatchObject({
        id: 'log-1',
        channel: 'fcm',
        createdAt: createdAt.toISOString(),
      });
    });
  });
});
