/**
 * Сервис апелляций на блокировки 289-ФЗ (v0.6.0-E ADR-035 → v0.7.0-C ADR-037).
 *
 * Апелляция — обжалование АКТИВНОЙ блокировки пары водитель–продавец:
 *   open → under_review (арбитр берёт в работу) → unblocked | rejected.
 *
 * Правила:
 *  - подать апелляцию может только СТОРОНА пары (водитель или продавец):
 *    обе стороны страдают от паузы, жалоба может прийти с любой;
 *    арбитр и посторонний — 403/404;
 *  - обжаловать можно только АКТИВНУЮ блокировку (unblockedAt IS NULL);
 *  - один АКТИВНЫЙ кейс на блокировку: повторная подача → 409; гонку
 *    одновременных POST ловит частичный unique-индекс (P2002 → 409);
 *    после закрытия (unblocked/rejected) подать снова можно — например,
 *    с новыми данными;
 *  - доказательства арбитра — история часов пары (месяцы, totalMinutes,
 *    monthCounted в деталях кейса) и переписка (v0.7.0-C, ADR-037):
 *    append-only, isInternal — служебные заметки арбитра;
 *  - решить кейс может только арбитр, ИЗ under_review и только тот, кто
 *    взял в работу;
 *  - unblock закрывает кейс и снимает блокировку в ОДНОЙ транзакции:
 *    BlockedPair помечается (unblockedAt/unblockedById/unblockReason),
 *    строка НЕ удаляется — аудит остаётся навсегда; reject оставляет
 *    блокировку как есть.
 *
 * Заморозка предмета (assertNoActiveAppeal для бизнес-переходов) не
 * нужна: предмет — блокировка — меняется только решением арбитра в той
 * же транзакции (ADR-035).
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ВАЖНО: value-import — PrismaService участвует в DI.
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toAppealDetailDto, toAppealDto } from '../common/serialization';
import {
  APPEAL_ACTIVE_STATUSES,
  APPEAL_MESSAGES_TAKE,
  APPEAL_MONTHS_TAKE,
} from './appeals.constants';
import type {
  AppealDetailDto,
  AppealDto,
  AppealMessageDto,
  AppealMessagesListDto,
  AppealsListDto,
  AppealStatus,
} from '@agromoll/types';
import type {
  AppealMessageInput,
  OpenAppealInput,
  ResolveAppealInput,
} from '@agromoll/validation';
import type { AuthenticatedUser } from '../auth/auth.types';

type TransactionClient = Prisma.TransactionClient;

/** Кейс со всеми связями для DTO (включая переписку, ADR-037). */
const APPEAL_VIEW_INCLUDE = {
  driver: { select: { id: true, displayName: true, role: true } },
  seller: { select: { id: true, displayName: true, role: true } },
  appellant: { select: { id: true, displayName: true, role: true } },
  assignedTo: { select: { id: true, displayName: true, role: true } },
  messages: {
    include: { author: { select: { id: true, displayName: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
    take: APPEAL_MESSAGES_TAKE,
  },
} as const satisfies Prisma.AppealCaseInclude;

type AppealWithRelations = Prisma.AppealCaseGetPayload<{
  include: typeof APPEAL_VIEW_INCLUDE;
}>;

/** Активные статусы кейса — тип из констант (те же значения, что в DTO). */
const ACTIVE_STATUSES: AppealStatus[] = [...APPEAL_ACTIVE_STATUSES];

@Injectable()
export class AppealsService {
  private readonly logger = new Logger(AppealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Открытие апелляции ───────────────────────────────────────────────────

  /** Открыть апелляцию на активную блокировку (только сторона пары). */
  async open(appellantId: string, input: OpenAppealInput): Promise<AppealDto> {
    const block = await this.prisma.blockedPair.findFirst({
      where: { id: input.blockedPairId, unblockedAt: null },
      select: { id: true, driverId: true, sellerId: true },
    });
    if (!block) {
      throw new NotFoundException('Блокировка не найдена или уже снята');
    }
    if (appellantId !== block.driverId && appellantId !== block.sellerId) {
      // Постороннему не раскрываем даже факт блокировки пары.
      throw new NotFoundException('Блокировка не найдена или уже снята');
    }

    const existing = await this.prisma.appealCase.findFirst({
      where: { blockedPairId: block.id, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('По этой блокировке уже идёт апелляция — дождитесь решения');
    }

    let created: AppealWithRelations;
    try {
      created = await this.prisma.appealCase.create({
        data: {
          blockedPairId: block.id,
          driverId: block.driverId,
          sellerId: block.sellerId,
          appellantId,
          reason: input.reason,
          status: 'open',
        },
        include: APPEAL_VIEW_INCLUDE,
      });
    } catch (error) {
      // Гонка двух подач: частичный unique-индекс — последний рубеж.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('По этой блокировке уже идёт апелляция — дождитесь решения');
      }
      throw error;
    }

    // Контрагент пары узнаёт об обжаловании (best-effort).
    const counterpartId = appellantId === block.driverId ? block.sellerId : block.driverId;
    await this.notifications.send({
      userId: counterpartId,
      type: 'appeal_opened',
      title: 'Апелляция на блокировку',
      body: `Пара обжалует блокировку по 289-ФЗ в арбитраже: «${trimReason(input.reason)}». Решение придёт в уведомлениях.`,
      data: { appealId: created.id },
    });

    return toAppealDto(created);
  }

  // ─── Чтение ───────────────────────────────────────────────────────────────

  /** Мои кейсы: поданные мной ИЛИ по моей паре (водитель/продавец). */
  async findMine(userId: string): Promise<AppealsListDto> {
    const appeals = await this.prisma.appealCase.findMany({
      where: {
        OR: [{ appellantId: userId }, { driverId: userId }, { sellerId: userId }],
      },
      include: APPEAL_VIEW_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
    return { items: appeals.map(toAppealDto) };
  }

  /** Очередь арбитра: активные кейсы, старые сверху. */
  async findQueue(): Promise<AppealsListDto> {
    const appeals = await this.prisma.appealCase.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      include: APPEAL_VIEW_INCLUDE,
      orderBy: { openedAt: 'asc' },
    });
    return { items: appeals.map(toAppealDto) };
  }

  /**
   * Детали кейса + история месяцев часов пары (доказательство арбитра)
   * + переписка (ADR-037; служебные заметки скрыты от сторон пары).
   * Доступ: стороны пары и арбитры; посторонним — 404 (не раскрываем факт).
   */
  async findOne(viewer: AuthenticatedUser, appealId: string): Promise<AppealDetailDto> {
    const appeal = await this.loadForView(appealId);
    this.assertCanAccess(viewer, appeal);

    const months = await this.prisma.monthlyPairTotal.findMany({
      where: { driverId: appeal.driverId, sellerId: appeal.sellerId },
      select: { month: true, totalMinutes: true, monthCounted: true },
      orderBy: { month: 'desc' },
      take: APPEAL_MONTHS_TAKE,
    });

    return toAppealDetailDto(filterInternalAppealMessages(viewer, appeal), months);
  }

  // ─── Переписка кейса (v0.7.0-C, ADR-037) ─────────────────────────────

  /**
   * Сообщение в кейсе: сторона пары или арбитр. Append-only.
   * Служебные заметки (isInternal) — только арбитр; паре — 403.
   */
  async postMessage(
    viewer: AuthenticatedUser,
    appealId: string,
    input: AppealMessageInput,
  ): Promise<AppealMessageDto> {
    const appeal = await this.loadForView(appealId);
    this.assertCanAccess(viewer, appeal);
    assertAppealActive(appeal);

    const isArbitrator = viewer.role === 'arbitrator';
    if (input.isInternal && !isArbitrator) {
      throw new ForbiddenException('Служебные заметки доступны только арбитру');
    }

    const message = await this.prisma.appealMessage.create({
      data: {
        appealId,
        authorId: viewer.id,
        body: input.body,
        isInternal: input.isInternal,
      },
      include: { author: { select: { id: true, displayName: true, role: true } } },
    });

    // Служебные заметки — только для арбитража, пара о них не узнаёт.
    // Публичное сообщение — обеим сторонам пары и арбитру (кроме автора).
    if (!input.isInternal) {
      await this.notifyCaseActivity(
        appeal,
        viewer.id,
        'Новое сообщение в апелляции',
        input.body.length > 120 ? `${input.body.slice(0, 117)}…` : input.body,
      );
    }

    return {
      id: message.id,
      author: message.author,
      body: message.body,
      isInternal: message.isInternal,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /**
   * Список сообщений кейса (ADR-037). Стороне пары — только публичные,
   * арбитру — все. Доступ к кейсу тот же, что в findOne.
   */
  async listMessages(
    viewer: AuthenticatedUser,
    appealId: string,
  ): Promise<AppealMessagesListDto> {
    const appeal = await this.loadForView(appealId);
    this.assertCanAccess(viewer, appeal);

    const messages = await this.prisma.appealMessage.findMany({
      where: { appealId },
      include: { author: { select: { id: true, displayName: true, role: true } } },
      orderBy: { createdAt: 'asc' },
      take: APPEAL_MESSAGES_TAKE,
    });

    const visible = viewer.role === 'arbitrator' ? messages : messages.filter((m) => !m.isInternal);
    return {
      items: visible.map((m) => ({
        id: m.id,
        author: m.author,
        body: m.body,
        isInternal: m.isInternal,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Загрузка кейса со связями (404 если нет). */
  private async loadForView(appealId: string): Promise<AppealWithRelations> {
    const appeal = await this.prisma.appealCase.findUnique({
      where: { id: appealId },
      include: APPEAL_VIEW_INCLUDE,
    });
    if (!appeal) {
      throw new NotFoundException('Апелляция не найдена');
    }
    return appeal;
  }

  /** Доступ: арбитр или сторона пары. Иначе 404 — не раскрываем сам факт. */
  private assertCanAccess(viewer: AuthenticatedUser, appeal: AppealWithRelations): void {
    const isPairMember = viewer.id === appeal.driverId || viewer.id === appeal.sellerId;
    const isArbitrator = viewer.role === 'arbitrator';
    if (!isPairMember && !isArbitrator) {
      throw new NotFoundException('Апелляция не найдена');
    }
  }

  // ─── Работа арбитра ───────────────────────────────────────────────────────

  /** Взять апелляцию в работу: open → under_review (только арбитр). */
  async assign(arbitratorId: string, appealId: string): Promise<AppealDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const appeal = await loadAppealForUpdate(tx, appealId);
      if (appeal.status !== 'open') {
        throw new ConflictException(
          appeal.status === 'under_review'
            ? 'Апелляция уже на рассмотрении'
            : 'Апелляция уже закрыта',
        );
      }
      return tx.appealCase.update({
        where: { id: appealId },
        data: {
          status: 'under_review',
          assignedToId: arbitratorId,
          assignedAt: new Date(),
        },
        include: APPEAL_VIEW_INCLUDE,
      });
    });

    await this.notifyPair(
      updated,
      'appeal_assigned',
      'Апелляция взята на рассмотрение',
      `Арбитр изучает обжалование блокировки по 289-ФЗ. Решение придёт здесь и в уведомлениях.`,
    );
    return toAppealDto(updated);
  }

  /**
   * Решение арбитра: under_review → unblocked | rejected.
   *
   * Всё в ОДНОЙ транзакции: закрытие кейса и (при unblock) снятие
   * блокировки. Пара может работать сразу после unblock — следующий
   * POST /work-hours/sessions пройдёт (ADR-035).
   */
  async resolve(
    arbitratorId: string,
    appealId: string,
    input: ResolveAppealInput,
  ): Promise<AppealDetailDto> {
    const resolvedCase = await this.prisma.$transaction(async (tx) => {
      const appeal = await loadAppealForUpdate(tx, appealId);
      if (appeal.status === 'open') {
        throw new ConflictException('Сначала возьмите апелляцию в работу (assign)');
      }
      if (appeal.status !== 'under_review') {
        throw new ConflictException('Апелляция уже закрыта');
      }
      if (appeal.assignedToId !== arbitratorId) {
        throw new ForbiddenException('Апелляцию рассматривает другой арбитр');
      }

      const data = {
        status: input.decision === 'unblock' ? ('unblocked' as const) : ('rejected' as const),
        resolvedById: arbitratorId,
        resolvedAt: new Date(),
        notes: input.notes ?? null,
      };

      if (input.decision === 'unblock') {
        // Снимаем блокировку тем же коммитом, что закрываем кейс:
        // «решение принято» и «пара может работать» — одно событие.
        // Строка не удаляется — аудит разблока остаётся навсегда.
        await tx.blockedPair.update({
          where: { id: appeal.blockedPairId },
          data: {
            unblockedAt: new Date(),
            unblockedById: arbitratorId,
            unblockReason: input.notes ?? 'Решение арбитража по апелляции',
          },
        });
      }

      return tx.appealCase.update({
        where: { id: appealId },
        data,
        include: APPEAL_VIEW_INCLUDE,
      });
    });

    if (input.decision === 'unblock') {
      this.logger.warn(
        {
          appealId: resolvedCase.id,
          blockedPairId: resolvedCase.blockedPairId,
          driverId: resolvedCase.driverId,
          sellerId: resolvedCase.sellerId,
          arbitratorId,
        },
        'appeals:блокировка 289-ФЗ снята арбитром (ADR-035)',
      );
    }

    const months = await this.prisma.monthlyPairTotal.findMany({
      where: { driverId: resolvedCase.driverId, sellerId: resolvedCase.sellerId },
      select: { month: true, totalMinutes: true, monthCounted: true },
      orderBy: { month: 'desc' },
      take: APPEAL_MONTHS_TAKE,
    });

    const decisionText =
      input.decision === 'unblock'
        ? 'Блокировка снята: пара может работать'
        : 'Апелляция отклонена: блокировка остаётся';
    await this.notifyPair(
      resolvedCase,
      'appeal_resolved',
      'Решение по апелляции',
      `${decisionText}.${input.notes ? ` ${input.notes}` : ''}`,
    );

    return toAppealDetailDto(resolvedCase, months);
  }

  // ─── Уведомления кейса ────────────────────────────────────────────────────

  /** Уведомить обе стороны пары (assign/resolve). */
  private async notifyPair(
    appeal: { id: string; driverId: string; sellerId: string },
    type: 'appeal_assigned' | 'appeal_resolved',
    title: string,
    body: string,
  ): Promise<void> {
    for (const userId of [appeal.driverId, appeal.sellerId]) {
      await this.notifications.send({
        userId,
        type,
        title,
        body,
        data: { appealId: appeal.id },
      });
    }
  }

  /**
   * Публичная активность в переписке (ADR-037): обеим сторонам пары и
   * назначенному арбитру, кроме автора. Зеркалит notifyCaseActivity
   * споров (ADR-033).
   */
  private async notifyCaseActivity(
    appeal: { id: string; driverId: string; sellerId: string; assignedToId: string | null },
    actorId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const targets = [appeal.driverId, appeal.sellerId].filter((id) => id !== actorId);
    if (appeal.assignedToId && appeal.assignedToId !== actorId) {
      targets.push(appeal.assignedToId);
    }
    for (const userId of targets) {
      await this.notifications.send({
        userId,
        type: 'appeal_message',
        title,
        body,
        data: { appealId: appeal.id },
      });
    }
  }
}

// ─── Помощники (вне класса — чистые функции) ────────────────────────────────

/** SELECT … FOR UPDATE: две транзакции не решают один кейс параллельно. */
async function loadAppealForUpdate(tx: TransactionClient, appealId: string) {
  const [appeal] = await tx.$queryRaw<
    Array<{
      id: string;
      blockedPairId: string;
      driverId: string;
      sellerId: string;
      status: AppealStatus;
      assignedToId: string | null;
    }>
  >`SELECT id, "blockedPairId", "driverId", "sellerId", status, "assignedToId"
    FROM appeal_cases
    WHERE id = ${appealId}
    FOR UPDATE`;
  if (!appeal) {
    throw new NotFoundException('Апелляция не найдена');
  }
  return appeal;
}

/** Причина в push-уведомлении — кратко (длинные тексты режем). */
function trimReason(reason: string): string {
  return reason.length > 120 ? `${reason.slice(0, 117)}…` : reason;
}

/** Кейс должен быть активным для переписки (закрытый — только чтение). */
function assertAppealActive(appeal: { status: AppealStatus }): void {
  if (!ACTIVE_STATUSES.includes(appeal.status)) {
    throw new ConflictException('Апелляция закрыта — переписка недоступна');
  }
}

/** Служебные заметки не отдаются сторонам пары — только арбитру. */
function filterInternalAppealMessages(
  viewer: AuthenticatedUser,
  appeal: AppealWithRelations,
): AppealWithRelations {
  if (viewer.role === 'arbitrator') {
    return appeal;
  }
  return {
    ...appeal,
    messages: (appeal.messages ?? []).filter((m) => !m.isInternal),
  };
}

