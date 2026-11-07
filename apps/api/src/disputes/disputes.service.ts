/**
 * Сервис арбитража споров (v0.6.0-C, ADR-033).
 *
 * Спор — эскалация конфликта сторон до нейтрального арбитра:
 *   open → under_review (арбитр берёт в работу) → resolved | dismissed.
 *
 * Правила:
 *  - открыть спор может только СТОРОНА объекта (бронь: buyer/seller,
 *    долг: дебитор/кредитор, доставка: buyer/доставщик либо продавец
 *    линии, пока водителя нет);
 *  - один АКТИВНЫЙ спор на объект: повторное открытие → 409; гонку
 *    одновременных открытий ловит частичный unique-индекс БД (P2002→409);
 *  - пока спор активен, объект ЗАМОРОЖЕН: бизнес-переходы брони/долга/
 *    доставки возвращают 409 (assertNoActiveDispute вызывают сервисы
 *    объектов) — стороны не меняют предмет спора под ногами арбитра;
 *  - сообщения append-only; isInternal — служебные заметки, видит
 *    только арбитр (фильтруются из DTO для сторон);
 *  - доказательства — файлы в S3-хранилище (presigned upload-url,
 *    v0.7.0-B, ADR-036); при недоступном хранилище — fallback
 *    data:-URL ≤ 500 КБ;
 *  - решить спор может только арбитр, ИЗ under_review (сначала взял
 *    в работу — потом решает), dismiss — «не спор вообще»;
 *  - решение меняет судьбу объекта (бронь/долг/доставка) в той же
 *    транзакции и бьёт по репутации виновного (ADR-033):
 *      favor_buyer  → продавцу   −1.0
 *      favor_seller → покупателю −1.0
 *      compromise   → обоим по −0.5
 *      no_fault     → рейтинг не трогаем
 *    Штрафы считаются ReputationService из закрытых кейсов (журнал —
 *    источник правды), здесь — только аудит-строки и пересчёт.
 *
 * «Покупатель/продавец» в решении — сторона сделки, не роль в системе:
 * в долге покупатель = дебитор, продавец = кредитор; в доставке
 * продавец = доставщик. Стороны фиксируются при открытии (firstParty /
 * secondParty) и не меняются.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ВАЖНО: value-import — PrismaService участвует в DI.
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from '../reputation/reputation.service';
import { StorageService } from '../storage/storage.service';
import {
  S3_URL_SCHEME,
  keyBelongsToDispute,
  s3KeyFromFileUrl,
} from '../storage/storage.constants';
import { toDisputeDetailDto, toDisputeDto } from '../common/serialization';
import { DISPUTE_MESSAGES_TAKE } from './disputes.constants';
import type {
  DisputeDetailDto,
  DisputeDto,
  DisputesListDto,
  DisputeEvidenceDto,
  DisputeEvidenceListDto,
  DisputeEvidenceUploadUrlDto,
  DisputeMessageDto,
  DisputeType,
} from '@agromoll/types';
import type {
  DisputeEvidenceInput,
  DisputeEvidenceUploadUrlInput,
  DisputeMessageInput,
  OpenDisputeInput,
  ResolveDisputeInput,
} from '@agromoll/validation';
import type { AuthenticatedUser } from '../auth/auth.types';

type TransactionClient = Prisma.TransactionClient;

/** Кейс со всеми связями для DTO. */
const DISPUTE_VIEW_INCLUDE = {
  firstParty: { select: { id: true, displayName: true, role: true } },
  secondParty: { select: { id: true, displayName: true, role: true } },
  openedBy: { select: { id: true, displayName: true, role: true } },
  assignedTo: { select: { id: true, displayName: true, role: true } },
  messages: {
    include: { author: { select: { id: true, displayName: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
    take: DISPUTE_MESSAGES_TAKE,
  },
  evidence: {
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedBy: { select: { id: true, displayName: true, role: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const satisfies Prisma.DisputeCaseInclude;

type DisputeWithRelations = Prisma.DisputeCaseGetPayload<{
  include: typeof DISPUTE_VIEW_INCLUDE;
}>;

/** Для списков — без переписки, только счётчики. */
const DISPUTE_LIST_INCLUDE = {
  firstParty: { select: { id: true, displayName: true, role: true } },
  secondParty: { select: { id: true, displayName: true, role: true } },
  openedBy: { select: { id: true, displayName: true, role: true } },
  assignedTo: { select: { id: true, displayName: true, role: true } },
  _count: { select: { messages: true, evidence: true } },
} as const satisfies Prisma.DisputeCaseInclude;

type DisputeListItem = Prisma.DisputeCaseGetPayload<{
  include: typeof DISPUTE_LIST_INCLUDE;
}>;

/** Активные статусы кейса (объект заморожен). */
const ACTIVE_STATUSES: DisputeDto['status'][] = ['open', 'under_review'];

/** Стороны объекта по его типу: first=«покупатель», second=«продавец». */
interface ObjectParties {
  firstPartyId: string;
  secondPartyId: string;
  /** Тема для списка/очереди. */
  subject: string;
}

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly reputation: ReputationService,
    private readonly storage: StorageService,
  ) {}

  // ─── Открытие спора ───────────────────────────────────────────────────────

  /** Открыть спор по объекту (только сторона объекта). */
  async open(openedById: string, input: OpenDisputeInput): Promise<DisputeDto> {
    const parties = await this.loadParties(input.type, input.referenceId);
    if (openedById !== parties.firstPartyId && openedById !== parties.secondPartyId) {
      throw new ForbiddenException('Открыть спор может только сторона сделки');
    }

    const existing = await this.prisma.disputeCase.findFirst({
      where: { type: input.type, referenceId: input.referenceId, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('По этому объекту уже идёт спор — дождитесь его решения');
    }

    let created: DisputeListItem;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const dispute = await tx.disputeCase.create({
          data: {
            type: input.type,
            referenceId: input.referenceId,
            firstPartyId: parties.firstPartyId,
            secondPartyId: parties.secondPartyId,
            openedById,
            subject: parties.subject,
            status: 'open',
            // Суть претензии — первое сообщение переписки: арбитр читает
            // кейс целиком, история начинается с причины.
            messages: {
              create: { authorId: openedById, body: input.reason, isInternal: false },
            },
          },
          include: DISPUTE_LIST_INCLUDE,
        });
        return dispute;
      });
    } catch (error) {
      // Гонка двух открытий: частичный unique-индекс — последний рубеж.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('По этому объекту уже идёт спор — дождитесь его решения');
      }
      throw error;
    }

    // Сторона-оппонент узнаёт об эскалации (best-effort).
    const counterpartyId =
      openedById === parties.firstPartyId ? parties.secondPartyId : parties.firstPartyId;
    await this.notifications.send({
      userId: counterpartyId,
      type: 'dispute_opened',
      title: 'Открыт спор',
      body: `По вашей сделке открыт спор: «${created.subject}». Опишите свою позицию в переписке кейса.`,
      data: { disputeId: created.id },
    });

    return toDisputeDto(created);
  }

  /** Стороны спорного объекта. Объект не найден → 404. */
  private async loadParties(type: DisputeType, referenceId: string): Promise<ObjectParties> {
    if (type === 'booking') {
      const booking = await this.prisma.booking.findUnique({
        where: { id: referenceId },
        select: { buyerId: true, listing: { select: { sellerId: true, title: true } } },
      });
      if (!booking) {
        throw new NotFoundException('Бронь не найдена');
      }
      return {
        firstPartyId: booking.buyerId,
        secondPartyId: booking.listing.sellerId,
        subject: `Бронь: ${booking.listing.title}`,
      };
    }

    if (type === 'debt') {
      const debt = await this.prisma.debt.findUnique({
        where: { id: referenceId },
        select: { debtorId: true, creditorId: true, amount: true },
      });
      if (!debt) {
        throw new NotFoundException('Долг не найден');
      }
      return {
        firstPartyId: debt.debtorId,
        secondPartyId: debt.creditorId,
        subject: `Долг: ${debt.amount} ₽`,
      };
    }

    const delivery = await this.prisma.deliveryRequest.findUnique({
      where: { id: referenceId },
      select: {
        buyerId: true,
        assignedDriverId: true,
        pickupPoint: { select: { ownerId: true } },
        dropoffPoint: { select: { label: true, address: true } },
      },
    });
    if (!delivery) {
      throw new NotFoundException('Доставка не найдена');
    }
    // «Продавец» доставки — исполнитель: назначенный водитель, а пока
    // его нет — владелец линии забора (продавец товара).
    const secondPartyId = delivery.assignedDriverId ?? delivery.pickupPoint.ownerId;
    const where = delivery.dropoffPoint.label ?? delivery.dropoffPoint.address ?? 'доставка';
    return {
      firstPartyId: delivery.buyerId,
      secondPartyId,
      subject: `Доставка: ${where}`,
    };
  }

  // ─── Чтение ───────────────────────────────────────────────────────────────

  /** Мои кейсы: стороны видят споры по своим сделкам. */
  async findMine(userId: string): Promise<DisputesListDto> {
    const disputes = await this.prisma.disputeCase.findMany({
      where: { OR: [{ firstPartyId: userId }, { secondPartyId: userId }] },
      include: DISPUTE_LIST_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
    return { items: disputes.map(toDisputeDto) };
  }

  /** Очередь арбитра: активные кейсы, старые сверху. */
  async findQueue(): Promise<DisputesListDto> {
    const disputes = await this.prisma.disputeCase.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      include: DISPUTE_LIST_INCLUDE,
      orderBy: { openedAt: 'asc' },
    });
    return { items: disputes.map(toDisputeDto) };
  }

  /** Детали кейса: арбитр видит всё, сторона — без служебных заметок. */
  async findOne(viewer: AuthenticatedUser, disputeId: string): Promise<DisputeDetailDto> {
    const dispute = await this.loadForView(disputeId);
    this.assertCanAccess(viewer, dispute);
    return toDisputeDetailDto(filterInternalFor(viewer, dispute));
  }

  /** Загрузка кейса со связями (404 если нет). */
  private async loadForView(disputeId: string): Promise<DisputeWithRelations> {
    const dispute = await this.prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: DISPUTE_VIEW_INCLUDE,
    });
    if (!dispute) {
      throw new NotFoundException('Спор не найден');
    }
    return dispute;
  }

  /** Доступ к кейсу: арбитр или сторона. Иначе 404 — не раскрываем сам факт. */
  private assertCanAccess(viewer: AuthenticatedUser, dispute: DisputeWithRelations): void {
    const isParty =
      viewer.id === dispute.firstPartyId || viewer.id === dispute.secondPartyId;
    const isArbitrator = viewer.role === 'arbitrator';
    if (!isParty && !isArbitrator) {
      throw new NotFoundException('Спор не найден');
    }
  }

  // ─── Переписка и доказательства ───────────────────────────────────────────

  /** Сообщение в кейсе (append-only). Служебные — только арбитр. */
  async postMessage(
    viewer: AuthenticatedUser,
    disputeId: string,
    input: DisputeMessageInput,
  ): Promise<DisputeMessageDto> {
    const dispute = await this.loadForView(disputeId);
    this.assertCanAccess(viewer, dispute);
    assertActive(dispute);

    const isArbitrator = viewer.role === 'arbitrator';
    if (input.isInternal && !isArbitrator) {
      throw new ForbiddenException('Служебные заметки доступны только арбитру');
    }

    const message = await this.prisma.disputeMessage.create({
      data: {
        disputeId,
        authorId: viewer.id,
        body: input.body,
        isInternal: input.isInternal,
      },
      include: { author: { select: { id: true, displayName: true, role: true } } },
    });

    // Служебные заметки — только для арбитража, стороны о них не узнают.
    if (!input.isInternal) {
      await this.notifyCaseActivity(
        dispute,
        viewer.id,
        'Новое сообщение в споре',
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
   * Presigned URL для прямой загрузки доказательства (v0.7.0-B, ADR-036).
   *
   * Файл идёт клиент → хранилище напрямую, API только подписывает ссылку.
   * Хранилище не настроено/недоступно → 503: клиент обязан упасть в
   * fallback (data:-URL ≤ 500 КБ), а не показывать пользователю общий
   * «сервер недоступен».
   */
  async createEvidenceUploadUrl(
    viewer: AuthenticatedUser,
    disputeId: string,
    input: DisputeEvidenceUploadUrlInput,
  ): Promise<DisputeEvidenceUploadUrlDto> {
    const dispute = await this.loadForView(disputeId);
    this.assertCanAccess(viewer, dispute);
    assertActive(dispute);

    if (!this.storage.isAvailable()) {
      throw new ServiceUnavailableException(
        'Хранилище файлов не настроено — используйте загрузку файлом (fallback)',
      );
    }

    return this.storage.presignPut(
      this.storage.evidenceObjectKey(disputeId, input.mimeType),
      input.mimeType,
    );
  }

  /**
   * Приложить доказательство (v0.7.0-B, ADR-036).
   *
   * Два пути (дискриминатор storage на входе):
   *  - s3: клиент загрузил файл по presigned URL и подтверждает objectKey.
   *    Сервис проверяет: ключ выдан ДЛЯ ЭТОГО спора (префикс), объект
   *    реально существует (HEAD), заявленные размер/тип совпадают с
   *    фактическими — «мёртвых» ссылок и лжи в метаданных не будет;
   *  - data: fallback — data:-URL ≤ 500 КБ (проверено zod) для случаев,
   *    когда хранилище недоступно. Критические доказательства не теряются.
   */
  async attachEvidence(
    viewer: AuthenticatedUser,
    disputeId: string,
    input: DisputeEvidenceInput,
  ): Promise<DisputeEvidenceDto> {
    const dispute = await this.loadForView(disputeId);
    this.assertCanAccess(viewer, dispute);
    assertActive(dispute);

    let fileUrl: string;
    let sizeBytes: number;
    let mimeType: string;

    if (input.storage === 's3') {
      if (!this.storage.isAvailable()) {
        throw new ServiceUnavailableException(
          'Хранилище файлов не настроено — используйте загрузку файлом (fallback)',
        );
      }
      if (!keyBelongsToDispute(input.objectKey, disputeId)) {
        throw new BadRequestException(
          'objectKey принадлежит другому спору — запросите ссылку заново',
        );
      }
      const head = await this.storage.headObject(input.objectKey);
      if (!head) {
        throw new BadRequestException(
          'Файл не найден в хранилище — сначала загрузите его по presigned URL',
        );
      }
      if (head.sizeBytes !== input.sizeBytes) {
        throw new BadRequestException(
          `Размер файла в хранилище (${head.sizeBytes} Б) отличается от заявленного (${input.sizeBytes} Б)`,
        );
      }
      if (head.mimeType && head.mimeType !== input.mimeType) {
        throw new BadRequestException(
          `Тип файла в хранилище (${head.mimeType}) отличается от заявленного (${input.mimeType})`,
        );
      }
      fileUrl = `${S3_URL_SCHEME}${input.objectKey}`;
      sizeBytes = input.sizeBytes;
      mimeType = input.mimeType;
    } else {
      // Сверка MIME из data:-URL с заявленным (схема не видит соседей,
      // а путаница типов сломает отображение файла на клиентах).
      const declaredInUrl = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(input.dataUrl)?.[1];
      if (declaredInUrl && declaredInUrl !== input.mimeType) {
        throw new BadRequestException(
          `Тип в dataUrl (${declaredInUrl}) отличается от заявленного mimeType (${input.mimeType})`,
        );
      }
      fileUrl = input.dataUrl;
      sizeBytes = decodedSizeBytes(input.dataUrl.slice(input.dataUrl.indexOf(',') + 1));
      mimeType = input.mimeType;
    }

    const evidence = await this.prisma.disputeEvidence.create({
      data: {
        disputeId,
        uploadedById: viewer.id,
        fileName: input.fileName,
        mimeType,
        sizeBytes,
        fileUrl,
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedBy: { select: { id: true, displayName: true, role: true } },
        createdAt: true,
      },
    });

    await this.notifyCaseActivity(
      dispute,
      viewer.id,
      'Новое доказательство в споре',
      evidence.fileName,
    );

    return {
      id: evidence.id,
      fileName: evidence.fileName,
      mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes,
      uploadedBy: evidence.uploadedBy,
      createdAt: evidence.createdAt.toISOString(),
    };
  }

  /**
   * Список доказательств с ссылками для просмотра (v0.7.0-B, ADR-036).
   *
   * Доступ — тот же, что к кейсу (участники + арбитр): проверка
   * выполняется и здесь, а не только в GET /disputes/:id, потому что
   * ссылка на файл — самый чувствительный артефакт кейса (presigned GET
   * короткоживущий, но окна в несколько минут хватит для утечки).
   */
  async listEvidence(
    viewer: AuthenticatedUser,
    disputeId: string,
  ): Promise<DisputeEvidenceListDto> {
    const dispute = await this.loadForView(disputeId);
    this.assertCanAccess(viewer, dispute);

    const rows = await this.prisma.disputeEvidence.findMany({
      where: { disputeId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        fileUrl: true,
        uploadedBy: { select: { id: true, displayName: true, role: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const items = await Promise.all(
      rows.map(async (row) => {
        const objectKey = s3KeyFromFileUrl(row.fileUrl);
        const url = objectKey
          ? await (this.storage.isAvailable()
              ? this.storage.presignGet(objectKey)
              : Promise.resolve(row.fileUrl))
          : row.fileUrl;
        return {
          id: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          uploadedBy: row.uploadedBy,
          createdAt: row.createdAt.toISOString(),
          url,
        };
      }),
    );

    return { items };
  }

  // ─── Работа арбитра ───────────────────────────────────────────────────────

  /** Взять спор в работу: open → under_review (только арбитр). */
  async assign(arbitratorId: string, disputeId: string): Promise<DisputeDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const dispute = await loadDisputeForUpdate(tx, disputeId);
      if (dispute.status !== 'open') {
        throw new ConflictException(
          dispute.status === 'under_review'
            ? 'Спор уже на рассмотрении'
            : 'Спор уже закрыт',
        );
      }
      return tx.disputeCase.update({
        where: { id: disputeId },
        data: {
          status: 'under_review',
          assignedToId: arbitratorId,
          assignedAt: new Date(),
        },
        include: DISPUTE_LIST_INCLUDE,
      });
    });

    await this.notifyBoth(
      updated,
      'dispute_assigned',
      'Спор взят на рассмотрение',
      `Арбитр изучает спор «${updated.subject}». Вы получите решение здесь и в уведомлениях.`,
    );
    return toDisputeDto(updated);
  }

  /**
   * Решение арбитра: under_review → resolved | dismissed + судьба объекта.
   *
   * Всё в ОДНОЙ транзакции: закрытие кейса, бронь/долг/доставка и их
   * журналы. Репутация — после транзакции (safe-триггер, ADR-013):
   * сбой пересчёта не откатывает решение.
   */
  async resolve(
    arbitratorId: string,
    disputeId: string,
    input: ResolveDisputeInput,
  ): Promise<DisputeDetailDto> {
    const resolvedCase = await this.prisma.$transaction(async (tx) => {
      const dispute = await loadDisputeForUpdate(tx, disputeId);
      if (dispute.status === 'open') {
        throw new ConflictException('Сначала возьмите спор в работу (assign)');
      }
      if (dispute.status !== 'under_review') {
        throw new ConflictException('Спор уже закрыт');
      }
      if (dispute.assignedToId !== arbitratorId) {
        throw new ForbiddenException('Спор рассматривает другой арбитр');
      }

      const isFinal = input.outcome !== 'no_fault' && input.outcome !== 'dismiss';
      if (isFinal) {
        // Судьба объекта — по типу кейса (zod не знает тип, сервис знает).
        if (dispute.type === 'booking') {
          if (!input.bookingOutcome) {
            throw new BadRequestException('Укажите судьбу брони (bookingOutcome)');
          }
          await this.applyBookingOutcome(tx, dispute, input.bookingOutcome);
        } else if (dispute.type === 'debt') {
          if (!input.debtOutcome) {
            throw new BadRequestException('Укажите судьбу долга (debtOutcome)');
          }
          await this.applyDebtOutcome(
            tx,
            dispute,
            input.debtOutcome,
            input.adjustedAmount ?? null,
          );
        } else if (input.deliveryOutcome === 'cancel') {
          await this.applyDeliveryOutcome(tx, dispute);
        }
      }

      return tx.disputeCase.update({
        where: { id: disputeId },
        data: {
          status: input.outcome === 'dismiss' ? 'dismissed' : 'resolved',
          resolution: input.outcome === 'dismiss' ? null : input.outcome,
          resolvedById: arbitratorId,
          resolvedAt: new Date(),
          notes: input.notes ?? null,
        },
        include: DISPUTE_VIEW_INCLUDE,
      });
    });

    // Репутация: штрафы виновного + пересчёт снимков (никогда не бросает).
    await this.reputation.safeOnDisputeResolved({
      id: resolvedCase.id,
      resolution: resolvedCase.resolution,
      firstPartyId: resolvedCase.firstPartyId,
      secondPartyId: resolvedCase.secondPartyId,
      resolvedAt: resolvedCase.resolvedAt,
    });
    // Судьба брони/долга меняла журналы — пересчитать «сделочные» веса.
    if (resolvedCase.type === 'booking') {
      await this.reputation.safeOnBookingDelivery(resolvedCase.referenceId);
    } else if (resolvedCase.type === 'debt') {
      await this.reputation.safeOnDebtChanged(resolvedCase.referenceId);
    }

    const resolutionText =
      input.outcome === 'dismiss'
        ? 'Спор отклонён: предмета для арбитража нет'
        : `Решение: ${input.outcome === 'favor_buyer' ? 'права сторона покупателя' : input.outcome === 'favor_seller' ? 'права сторона продавца' : input.outcome === 'compromise' ? 'компромисс' : 'вины нет'}`;
    await this.notifyBoth(
      resolvedCase,
      'dispute_resolved',
      'Решение по спору',
      `${resolutionText}.${input.notes ? ` ${input.notes}` : ''}`,
    );

    return toDisputeDetailDto(resolvedCase);
  }

  // ─── Судьба объекта (в транзакции решения) ────────────────────────────────

  /** Бронь: cancel (резерв возвращается) | complete | complete_minor. */
  private async applyBookingOutcome(
    tx: TransactionClient,
    dispute: { referenceId: string },
    outcome: 'cancel' | 'complete' | 'complete_minor',
  ): Promise<void> {
    const booking = await tx.booking.findUnique({
      where: { id: dispute.referenceId },
      select: {
        id: true,
        status: true,
        listingId: true,
        requestedQuantity: true,
        confirmedQuantity: true,
      },
    });
    if (!booking) {
      throw new NotFoundException('Бронь спора не найдена');
    }
    if (booking.status === 'cancelled' || booking.status === 'expired') {
      throw new ConflictException('Бронь уже закрыта — менять нечего');
    }

    if (outcome === 'cancel') {
      // Резерв возвращается листингу (как при обычной отмене, ADR-004).
      const reserved = booking.confirmedQuantity ?? booking.requestedQuantity;
      await tx.$executeRaw`
        UPDATE listings
        SET "quantityReserved" = "quantityReserved" - ${reserved}
        WHERE id = ${booking.listingId}
          AND "quantityReserved" >= ${reserved}`;
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'cancelled' },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId: booking.id,
          actorId: null,
          action: 'cancelled',
          payload: { byArbitration: true, disputeId: dispute.referenceId },
        },
      });
      return;
    }

    // complete / complete_minor: приёмка состоялась решением арбитра.
    const quantity = booking.confirmedQuantity ?? booking.requestedQuantity;
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'completed',
        deliveryConfirmedAt: new Date(),
        receivedQuantity: quantity,
        qualityFlag: outcome === 'complete_minor' ? 'minor_issue' : 'ok',
      },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        actorId: null,
        action: 'delivery_confirmed',
        payload: {
          byArbitration: true,
          disputeId: dispute.referenceId,
          qualityFlag: outcome === 'complete_minor' ? 'minor_issue' : 'ok',
        },
      },
    });
  }

  /** Долг: cancel | restore_active | settle_adjusted (со снижением суммы). */
  private async applyDebtOutcome(
    tx: TransactionClient,
    dispute: { referenceId: string },
    outcome: 'cancel' | 'restore_active' | 'settle_adjusted',
    adjustedAmount: number | null,
  ): Promise<void> {
    const debt = await tx.debt.findUnique({
      where: { id: dispute.referenceId },
      select: { id: true, status: true, amount: true },
    });
    if (!debt) {
      throw new NotFoundException('Долг спора не найден');
    }
    if (debt.status === 'cancelled') {
      throw new ConflictException('Долг уже отменён');
    }
    if (outcome === 'settle_adjusted') {
      if (adjustedAmount === null) {
        throw new BadRequestException('При settle_adjusted укажите новую сумму');
      }
      // Новая сумма не может превышать исходную и должна быть положительной
      // (zod уже гарантирует 0 < S ≤ 1 000 000; здесь — верхняя граница).
      if (adjustedAmount > debt.amount.toNumber()) {
        throw new BadRequestException(
          `Новая сумма больше текущей (${debt.amount.toString()} ₽) — это не скидка`,
        );
      }
    }

    // Спор по долгу (mutual, ADR-010) закрывается решением арбитража:
    // resolve_confirmed нейтрализует минус спорного события в рейтинге
    // дебитора (ReputationService считает resolve_confirmed нейтральным).
    if (debt.status === 'disputed') {
      await tx.debtEvent.create({
        data: {
          debtId: debt.id,
          actorId: null,
          action: 'resolve_confirmed',
          payload: { byArbitration: true, disputeId: dispute.referenceId },
        },
      });
    }

    if (outcome === 'cancel') {
      await tx.debt.update({ where: { id: debt.id }, data: { status: 'cancelled' } });
      await tx.debtEvent.create({
        data: {
          debtId: debt.id,
          actorId: null,
          action: 'cancelled',
          payload: { byArbitration: true, disputeId: dispute.referenceId },
        },
      });
      return;
    }

    if (outcome === 'restore_active') {
      await tx.debt.update({
        where: { id: debt.id },
        data: { status: 'active', resolveRequestedBy: null },
      });
      return;
    }

    // settle_adjusted: локальное сужение типа (null отсечён выше).
    const newAmount = adjustedAmount;
    if (newAmount === null) {
      throw new BadRequestException('При settle_adjusted укажите новую сумму');
    }
    await tx.debt.update({
      where: { id: debt.id },
      data: {
        status: 'settled',
        amount: newAmount,
        settledAt: new Date(),
        resolveRequestedBy: null,
      },
    });
    await tx.debtEvent.create({
      data: {
        debtId: debt.id,
        actorId: null,
        action: 'settled',
        payload: {
          byArbitration: true,
          disputeId: dispute.referenceId,
          adjustedAmount: newAmount,
          originalAmount: debt.amount.toNumber(),
        },
      },
    });
  }

  /** Доставка: отмена решением арбитража. */
  private async applyDeliveryOutcome(
    tx: TransactionClient,
    dispute: { referenceId: string },
  ): Promise<void> {
    const delivery = await tx.deliveryRequest.findUnique({
      where: { id: dispute.referenceId },
      select: { id: true, status: true },
    });
    if (!delivery) {
      throw new NotFoundException('Доставка спора не найдена');
    }
    if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
      throw new ConflictException('Доставка уже закрыта — менять нечего');
    }
    await tx.deliveryRequest.update({
      where: { id: delivery.id },
      data: { status: 'cancelled' },
    });
    await tx.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        actorId: null,
        action: 'cancelled',
        payload: { byArbitration: true, disputeId: dispute.referenceId },
      },
    });
  }

  // ─── Заморозка объектов (вызывают сервисы брони/долга/доставки) ──────────

  /** Есть ли АКТИВНЫЙ спор по объекту (open/under_review). */
  async hasActiveDispute(
    type: DisputeType,
    referenceId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const dispute = await client.disputeCase.findFirst({
      where: { type, referenceId, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    return dispute !== null;
  }

  /**
   * Бросает 409, если по объекту идёт арбитраж. Вызывается сервисами
   * объектов ПЕРЕД каждым бизнес-переходом (можно внутри их транзакции —
   * передайте tx) — пока арбитр не решил, предмет спора не меняется
   * (ADR-033).
   */
  async assertNoActiveDispute(
    type: DisputeType,
    referenceId: string,
    client?: Prisma.TransactionClient,
  ): Promise<void> {
    if (await this.hasActiveDispute(type, referenceId, client ?? this.prisma)) {
      throw new ConflictException(
        'По объекту идёт арбитраж — операции заморожены до решения арбитра',
      );
    }
  }

  // ─── Уведомления кейса ────────────────────────────────────────────────────

  /** Сообщить участникам (кроме автора действия) о событии в кейсе. */
  private async notifyCaseActivity(
    dispute: DisputeWithRelations,
    actorId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const targets = [dispute.firstPartyId, dispute.secondPartyId].filter(
      (id) => id !== actorId,
    );
    // Публичная активность в кейсе видна и арбитру, если уже назначен.
    if (dispute.assignedToId && dispute.assignedToId !== actorId) {
      targets.push(dispute.assignedToId);
    }
    for (const userId of targets) {
      await this.notifications.send({
        userId,
        type: 'dispute_message',
        title,
        body,
        data: { disputeId: dispute.id },
      });
    }
  }

  /** Уведомить обе стороны кейса (assign/resolve). */
  private async notifyBoth(
    dispute: { id: string; subject: string; firstPartyId: string; secondPartyId: string },
    type: 'dispute_assigned' | 'dispute_resolved',
    title: string,
    body: string,
  ): Promise<void> {
    for (const userId of [dispute.firstPartyId, dispute.secondPartyId]) {
      await this.notifications.send({
        userId,
        type,
        title,
        body,
        data: { disputeId: dispute.id },
      });
    }
  }
}

// ─── Помощники (вне класса — чистые функции) ────────────────────────────────

/** SELECT … FOR UPDATE: две транзакции не решают один кейс параллельно. */
async function loadDisputeForUpdate(tx: TransactionClient, disputeId: string) {
  const [dispute] = await tx.$queryRaw<
    Array<{
      id: string;
      status: DisputeDto['status'];
      type: DisputeType;
      referenceId: string;
      assignedToId: string | null;
    }>
  >`SELECT id, status, type, "referenceId", "assignedToId"
    FROM dispute_cases
    WHERE id = ${disputeId}
    FOR UPDATE`;
  if (!dispute) {
    throw new NotFoundException('Спор не найден');
  }
  return dispute;
}

/** Кейс должен быть активным для переписки/доказательств. */
function assertActive(dispute: { status: DisputeDto['status'] }): void {
  if (dispute.status !== 'open' && dispute.status !== 'under_review') {
    throw new ConflictException('Спор закрыт — переписка недоступна');
  }
}

/** Размер декодированного base64 (без Buffer — работает и на edge). */
function decodedSizeBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Служебные заметки не отдаются сторонам — только арбитру. */
function filterInternalFor(
  viewer: { id: string; role: string },
  dispute: DisputeWithRelations,
): DisputeWithRelations {
  if (viewer.role === 'arbitrator') {
    return dispute;
  }
  return {
    ...dispute,
    messages: dispute.messages.filter((m) => !m.isInternal),
  };
}
