/**
 * Контроллер арбитража (v0.6.0-C, ADR-033).
 *
 * Роли на эндпоинтах — первая линия обороны (RolesGuard), принадлежность
 * кейсу — вторая (методы сервиса). Арбитр не открывает споры (не бывает
 * стороной сделки) и не пишет от имени сторон; стороны не решают кейсы.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  DisputeEvidenceSchema,
  DisputeEvidenceUploadUrlSchema,
  DisputeMessageSchema,
  OpenDisputeSchema,
  ResolveDisputeSchema,
} from '@agromoll/validation';
import type {
  DisputeEvidenceInput,
  DisputeEvidenceUploadUrlInput,
  DisputeMessageInput,
  OpenDisputeInput,
  ResolveDisputeInput,
} from '@agromoll/validation';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../common/idempotency.interceptor';
import { DisputesService } from './disputes.service';

@Controller('disputes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * Открыть спор по объекту — только участники рынка (buyer/seller/driver),
   * арбитр стороной быть не может.
   */
  @Post()
  @Roles('buyer', 'seller', 'driver')
  @Idempotent('open_dispute')
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(OpenDisputeSchema)) body: OpenDisputeInput,
  ) {
    return this.disputes.open(user.id, body);
  }

  /** Мои споры (сторонам) — арбитру возвращается пусто: он не сторона. */
  @Get()
  async findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.disputes.findMine(user.id);
  }

  /** Очередь арбитража: активные кейсы, старые сверху — только арбитр. */
  @Get('queue')
  @Roles('arbitrator')
  async findQueue() {
    return this.disputes.findQueue();
  }

  /** Детали кейса: арбитр видит служебные заметки, стороны — нет. */
  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.findOne(user, id);
  }

  /** Сообщение в переписке кейса (append-only). */
  @Post(':id/messages')
  @Idempotent('dispute_message')
  async postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DisputeMessageSchema)) body: DisputeMessageInput,
  ) {
    return this.disputes.postMessage(user, id, body);
  }

  /** Список доказательств кейса с ссылками (участники + арбитр, ADR-036). */
  @Get(':id/evidence')
  async listEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.disputes.listEvidence(user, id);
  }

  /** Presigned URL для прямой загрузки файла в хранилище (ADR-036). */
  @Post(':id/evidence/upload-url')
  async createEvidenceUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DisputeEvidenceUploadUrlSchema)) body: DisputeEvidenceUploadUrlInput,
  ) {
    return this.disputes.createEvidenceUploadUrl(user, id, body);
  }

  /**
   * Подтвердить загрузку: objectKey (S3) или data:-URL (fallback ≤ 500 КБ).
   */
  @Post(':id/evidence')
  @Idempotent('dispute_evidence')
  async attachEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DisputeEvidenceSchema)) body: DisputeEvidenceInput,
  ) {
    return this.disputes.attachEvidence(user, id, body);
  }

  /** Взять спор в работу: open → under_review. Только арбитр. */
  @Post(':id/assign')
  @Roles('arbitrator')
  @Idempotent('assign_dispute')
  async assign(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.assign(user.id, id);
  }

  /** Решение по спору: подвести итог и изменить судьбу объекта. Только арбитр. */
  @Post(':id/resolve')
  @Roles('arbitrator')
  @Idempotent('resolve_dispute')
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResolveDisputeSchema)) body: ResolveDisputeInput,
  ) {
    return this.disputes.resolve(user.id, id, body);
  }
}
