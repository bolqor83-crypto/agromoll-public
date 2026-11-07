/**
 * «Арбитраж» (v0.6.0-C, ADR-033; апелляции — v0.6.0-E, ADR-035):
 * рабочее место арбитра.
 *
 * Две вкладки:
 *  - «Споры»: очередь активных кейсов (старые сверху) → кейс: переписка
 *    (со служебными заметками), «взять в работу», форма решения;
 *  - «Апелляции 289-ФЗ»: очередь обжалований блокировок пар → кейс:
 *    история месяцев часов (главное доказательство — считалась ли
 *    серия честно), «взять в работу», разблок/отклонение.
 *
 * Доступ — только роль arbitrator: сервер отклонит остальных (403),
 * экран честно показывает это состояние.
 */
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Screen,
  SkeletonCard,
  radius,
  spacing,
  Text,
} from '@agromoll/ui';
import {
  APPEAL_DECISION_LABELS,
  APPEAL_DECISIONS,
  APPEAL_STATUS_LABELS,
  DISPUTE_BOOKING_OUTCOMES,
  DISPUTE_DEBT_OUTCOMES,
  DISPUTE_OUTCOMES,
  DISPUTE_RESOLUTION_LABELS,
  DISPUTE_STATUS_LABELS,
  DISPUTE_TYPE_LABELS,
} from '@agromoll/types';
import type {
  AppealDecision,
  AppealDetailDto,
  AppealDto,
  DisputeDetailDto,
  DisputeDto,
  DisputeEvidenceItemDto,
  DisputeOutcome,
} from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/auth';

/** Человекочитаемые подписи решений и исходов объекта. */
const OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  favor_buyer: 'Прав покупатель',
  favor_seller: 'Прав продавец',
  compromise: 'Компромисс (обеим −0.5)',
  no_fault: 'Вины нет',
  dismiss: 'Отклонить спор',
};

const BOOKING_OUTCOME_LABELS: Record<string, string> = {
  cancel: 'Отменить бронь (резерв вернуть)',
  complete: 'Завершить как принятую (ok)',
  complete_minor: 'Завершить с мелкими проблемами',
};

const DEBT_OUTCOME_LABELS: Record<string, string> = {
  cancel: 'Отменить долг',
  restore_active: 'Вернуть в активные',
  settle_adjusted: 'Погасить со сниженной суммой',
};

/** Часы из минут для списка месяцев-доказательств. */
function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${hours} ч`;
}

type QueueState<T> =
  { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; items: T[] };

type DetailState<T> =
  | { phase: 'loading'; id: string }
  | { phase: 'error'; id: string; error: unknown }
  | { phase: 'ready'; detail: T };

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day}.${month} ${time}`;
}

export default function ArbitrationScreen() {
  const user = useAuthStore((s) => s.user);
  const isArbitrator = user?.role === 'arbitrator';

  // v0.6.0-E (ADR-035): вкладка очереди — споры или апелляции блокировок.
  const [section, setSection] = useState<'disputes' | 'appeals'>('disputes');
  const [queue, setQueue] = useState<QueueState<DisputeDto>>({ phase: 'loading' });
  const [detail, setDetail] = useState<DetailState<DisputeDetailDto> | null>(null);
  // Доказательства с ссылками (v0.7.0-B): отдельным запросом после кейса.
  const [evidenceItems, setEvidenceItems] = useState<DisputeEvidenceItemDto[]>([]);
  // Форма решения по спору.
  const [outcome, setOutcome] = useState<DisputeOutcome | null>(null);
  const [bookingOutcome, setBookingOutcome] = useState<string | null>(null);
  const [debtOutcome, setDebtOutcome] = useState<string | null>(null);
  const [adjustedText, setAdjustedText] = useState('');
  const [notes, setNotes] = useState('');
  const [note, setNote] = useState('');
  const [noteInternal, setNoteInternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ─── Апелляции 289-ФЗ (v0.6.0-E, ADR-035) ────────────────────────────────
  const [appealQueue, setAppealQueue] = useState<QueueState<AppealDto>>({ phase: 'loading' });
  const [appealDetail, setAppealDetail] = useState<DetailState<AppealDetailDto> | null>(null);
  const [appealDecision, setAppealDecision] = useState<AppealDecision | null>(null);
  const [appealNotes, setAppealNotes] = useState('');
  // Переписка апелляции (v0.7.0-C, ADR-037): ввод + переключатель «служебная».
  const [appealNote, setAppealNote] = useState('');
  const [appealNoteInternal, setAppealNoteInternal] = useState(false);

  const loadQueue = useCallback(async (): Promise<void> => {
    if (!isArbitrator) {
      return;
    }
    try {
      const list = await api.disputeQueue();
      setQueue({ phase: 'ready', items: list.items });
    } catch (error) {
      logger.warn('arbitration', 'очередь не загрузилась', { error: String(error) });
      setQueue((prev) => (prev.phase === 'ready' ? prev : { phase: 'error', error }));
    }
  }, [isArbitrator]);

  const loadAppealQueue = useCallback(async (): Promise<void> => {
    if (!isArbitrator) {
      return;
    }
    try {
      const list = await api.appealQueue();
      setAppealQueue({ phase: 'ready', items: list.items });
    } catch (error) {
      logger.warn('arbitration', 'очередь апелляций не загрузилась', { error: String(error) });
      setAppealQueue((prev) => (prev.phase === 'ready' ? prev : { phase: 'error', error }));
    }
  }, [isArbitrator]);

  useEffect(() => {
    void loadQueue();
    void loadAppealQueue();
  }, [loadQueue, loadAppealQueue]);

  const loadDetail = useCallback(async (disputeId: string): Promise<void> => {
    setDetail({ phase: 'loading', id: disputeId });
    try {
      const caseDetail = await api.dispute(disputeId);
      setDetail({ phase: 'ready', detail: caseDetail });
      // Доказательства с ссылками (v0.7.0-B, ADR-036): арбитр — главный
      // потребитель фото, сбой их загрузки не должен прятать кейс.
      try {
        const evidence = await api.disputeEvidence(disputeId);
        setEvidenceItems(evidence.items);
      } catch (err) {
        logger.warn('arbitration', 'ссылки на доказательства не загрузились', {
          disputeId,
          error: String(err),
        });
        setEvidenceItems([]);
      }
    } catch (error) {
      logger.warn('arbitration', 'кейс не загрузился', { disputeId, error: String(error) });
      setDetail({ phase: 'error', id: disputeId, error });
    }
  }, []);

  const loadAppealDetail = useCallback(async (appealId: string): Promise<void> => {
    setAppealDetail({ phase: 'loading', id: appealId });
    try {
      const caseDetail = await api.appeal(appealId);
      setAppealDetail({ phase: 'ready', detail: caseDetail });
    } catch (error) {
      logger.warn('arbitration', 'апелляция не загрузилась', { appealId, error: String(error) });
      setAppealDetail({ phase: 'error', id: appealId, error });
    }
  }, []);

  const resetForm = useCallback((): void => {
    setOutcome(null);
    setBookingOutcome(null);
    setDebtOutcome(null);
    setAdjustedText('');
    setNotes('');
    setNote('');
    setNoteInternal(true);
    setActionError(null);
  }, []);

  const resetAppealForm = useCallback((): void => {
    setAppealDecision(null);
    setAppealNotes('');
    setAppealNote('');
    setAppealNoteInternal(false);
    setActionError(null);
  }, []);

  const runAction = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      const apiError = toApiError(error);
      setActionError(
        isInvalidResponseError(error) ? 'Сервер ответил неожиданно' : apiError.message,
      );
    } finally {
      setBusy(false);
    }
  }, []);

  /** Сообщение в переписке апелляции (v0.7.0-C, ADR-037). */
  const handleSendAppealNote = useCallback(
    (appealId: string): void => {
      const body = appealNote.trim();
      if (body.length === 0) {
        return;
      }
      void runAction(async () => {
        await api.sendAppealMessage(appealId, body, appealNoteInternal);
        setAppealNote('');
        await loadAppealDetail(appealId);
      });
    },
    [appealNote, appealNoteInternal, runAction, loadAppealDetail],
  );

  const handleAssign = useCallback(
    (disputeId: string): void => {
      void runAction(async () => {
        await api.assignDispute(disputeId);
        await loadDetail(disputeId);
        await loadQueue();
      });
    },
    [runAction, loadDetail, loadQueue],
  );

  const handleSendNote = useCallback(
    (disputeId: string): void => {
      const body = note.trim();
      if (body.length === 0) {
        return;
      }
      void runAction(async () => {
        await api.sendDisputeMessage(disputeId, body, noteInternal);
        setNote('');
        await loadDetail(disputeId);
      });
    },
    [note, noteInternal, runAction, loadDetail],
  );

  /** Валидация формы решения перед отправкой. */
  const resolveDisabled = useCallback((): string | null => {
    if (!detail || detail.phase !== 'ready' || outcome === null) {
      return 'Выберите решение';
    }
    const isFinal = outcome !== 'no_fault' && outcome !== 'dismiss';
    if (!isFinal) {
      return null;
    }
    if (detail.detail.type === 'booking' && bookingOutcome === null) {
      return 'Выберите судьбу брони';
    }
    if (detail.detail.type === 'debt') {
      if (debtOutcome === null) {
        return 'Выберите судьбу долга';
      }
      if (debtOutcome === 'settle_adjusted') {
        const amount = Number.parseFloat(adjustedText.replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0) {
          return 'Укажите новую сумму долга';
        }
      }
    }
    return null;
  }, [detail, outcome, bookingOutcome, debtOutcome, adjustedText]);

  const handleResolve = useCallback(
    (disputeId: string): void => {
      if (outcome === null) {
        return;
      }
      void runAction(async () => {
        const adjusted =
          debtOutcome === 'settle_adjusted'
            ? Number.parseFloat(adjustedText.replace(',', '.'))
            : undefined;
        await api.resolveDispute(disputeId, {
          outcome,
          notes: notes.trim() || undefined,
          ...(bookingOutcome ? { bookingOutcome: bookingOutcome as 'cancel' } : {}),
          ...(debtOutcome ? { debtOutcome: debtOutcome as 'cancel' } : {}),
          ...(Number.isFinite(adjusted) ? { adjustedAmount: adjusted } : {}),
        });
        resetForm();
        await loadDetail(disputeId);
        await loadQueue();
      });
    },
    [
      outcome,
      debtOutcome,
      adjustedText,
      notes,
      bookingOutcome,
      runAction,
      resetForm,
      loadDetail,
      loadQueue,
    ],
  );

  // ─── Действия арбитра по апелляции (ADR-035) ─────────────────────────────

  const handleAssignAppeal = useCallback(
    (appealId: string): void => {
      void runAction(async () => {
        await api.assignAppeal(appealId);
        await loadAppealDetail(appealId);
        await loadAppealQueue();
      });
    },
    [runAction, loadAppealDetail, loadAppealQueue],
  );

  const handleResolveAppeal = useCallback(
    (appealId: string): void => {
      if (appealDecision === null) {
        return;
      }
      void runAction(async () => {
        await api.resolveAppeal(appealId, {
          decision: appealDecision,
          notes: appealNotes.trim() || undefined,
        });
        resetAppealForm();
        await loadAppealDetail(appealId);
        await loadAppealQueue();
      });
    },
    [appealDecision, appealNotes, runAction, resetAppealForm, loadAppealDetail, loadAppealQueue],
  );

  // ─── Не-арбитр: честное пустое состояние ──────────────────────────────────

  if (!isArbitrator) {
    return (
      <Screen>
        <ScreenHeader title="Арбитраж" subtitle="Рабочее место арбитра рынка" />
        <EmptyState
          illustration="box"
          title="Доступно только арбитрам"
          description="Роль арбитра выдаётся администрацией рынка. Свои споры смотрите в разделе «Споры»."
        />
      </Screen>
    );
  }

  // ─── Кейс спора: переписка + решение ──────────────────────────────────────

  if (detail) {
    const ready = detail.phase === 'ready' ? detail.detail : null;
    const isActive = ready?.status === 'open' || ready?.status === 'under_review';
    const isMine = ready?.assignedTo?.id === user?.id;
    const isFinalOutcome = outcome !== null && outcome !== 'no_fault' && outcome !== 'dismiss';
    const resolveHint = resolveDisabled();

    return (
      <Screen scroll={false}>
        <ScreenHeader
          title={ready?.subject ?? 'Кейс'}
          subtitle={
            ready
              ? `${DISPUTE_TYPE_LABELS[ready.type]} · ${DISPUTE_STATUS_LABELS[ready.status]}`
              : 'Кейс арбитража'
          }
          badge={
            ready ? (
              <Badge
                label={DISPUTE_STATUS_LABELS[ready.status]}
                variant={isActive ? 'attention' : 'success'}
              />
            ) : undefined
          }
        />
        {detail.phase === 'loading' ? (
          <SkeletonCard />
        ) : detail.phase === 'error' ? (
          <ErrorState
            {...errorContentFor(detail.error)}
            onRetry={() => void loadDetail(detail.id)}
            variant="inline"
          />
        ) : ready ? (
          <View style={{ flex: 1, gap: spacing.md, paddingHorizontal: spacing.lg }}>
            <Card>
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" color="secondary">
                  {ready.firstParty.displayName} (покупательская сторона) ↔{' '}
                  {ready.secondParty.displayName} (продавецкая сторона)
                </Text>
                <Text variant="caption" color="secondary">
                  Открыто {formatWhen(ready.openedAt)} · доказательств: {ready.evidence.length}
                </Text>
              </View>
            </Card>

            {/* Доказательства (v0.7.0-B, ADR-036): арбитр решает по фото —
                превью прямо в кейсе, без скачки по именам файлов. */}
            {evidenceItems.length > 0 ? (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <Text variant="caption" color="secondary">
                    Доказательства · {evidenceItems.length}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {evidenceItems.map((item) =>
                      item.mimeType.startsWith('image/') ? (
                        <Image
                          key={item.id}
                          source={{ uri: item.url }}
                          style={{
                            width: 88,
                            height: 88,
                            borderRadius: radius.sm,
                            backgroundColor: '#E8ECE9',
                          }}
                          accessibilityLabel={`Доказательство: ${item.fileName}`}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          key={item.id}
                          style={{
                            padding: spacing.sm,
                            borderRadius: radius.sm,
                            backgroundColor: '#E8ECE9',
                          }}
                        >
                          <Text variant="caption" color="secondary">
                            Документ: {item.fileName}
                          </Text>
                        </View>
                      ),
                    )}
                  </View>
                </View>
              </Card>
            ) : null}

            {/* Переписка: арбитр видит служебные заметки */}
            <View style={{ flex: 1, gap: spacing.sm }}>
              {ready.messages.map((message) => (
                <Card key={message.id}>
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="caption" color={message.isInternal ? 'primary' : 'secondary'}>
                      {message.author.displayName} · {formatWhen(message.createdAt)}
                      {message.isInternal ? ' · служебная' : ''}
                    </Text>
                    <Text variant="body">{message.body}</Text>
                  </View>
                </Card>
              ))}
            </View>

            {isActive ? (
              <View style={{ gap: spacing.md }}>
                {/* Заметка в кейс */}
                <Input
                  label={
                    noteInternal ? 'Служебная заметка (только арбитрам)' : 'Сообщение сторонам'
                  }
                  value={note}
                  onChangeText={setNote}
                  multiline
                  numberOfLines={2}
                  placeholder="Ход расследования"
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    title={noteInternal ? 'Служебная' : 'Сторонам'}
                    variant="secondary"
                    onPress={() => setNoteInternal((prev) => !prev)}
                  />
                  <Button
                    title="Отправить"
                    variant="secondary"
                    disabled={note.trim().length === 0 || busy}
                    loading={busy}
                    onPress={() => handleSendNote(ready.id)}
                  />
                </View>

                {ready.status === 'open' ? (
                  <Button
                    title="Взять в работу"
                    variant="primary"
                    disabled={busy}
                    loading={busy}
                    onPress={() => handleAssign(ready.id)}
                  />
                ) : isMine ? (
                  <Card>
                    <View style={{ gap: spacing.sm }}>
                      <Text variant="title">Решение</Text>
                      {DISPUTE_OUTCOMES.map((option) => (
                        <Button
                          key={option}
                          title={OUTCOME_LABELS[option]}
                          variant={outcome === option ? 'primary' : 'secondary'}
                          disabled={busy}
                          onPress={() => setOutcome(option)}
                        />
                      ))}
                      {isFinalOutcome && ready.type === 'booking'
                        ? DISPUTE_BOOKING_OUTCOMES.map((option) => (
                            <Button
                              key={option}
                              title={BOOKING_OUTCOME_LABELS[option]}
                              variant={bookingOutcome === option ? 'primary' : 'secondary'}
                              disabled={busy}
                              onPress={() => setBookingOutcome(option)}
                            />
                          ))
                        : null}
                      {isFinalOutcome && ready.type === 'debt' ? (
                        <>
                          {DISPUTE_DEBT_OUTCOMES.map((option) => (
                            <Button
                              key={option}
                              title={DEBT_OUTCOME_LABELS[option]}
                              variant={debtOutcome === option ? 'primary' : 'secondary'}
                              disabled={busy}
                              onPress={() => setDebtOutcome(option)}
                            />
                          ))}
                          {debtOutcome === 'settle_adjusted' ? (
                            <Input
                              label="Новая сумма долга, ₽"
                              value={adjustedText}
                              onChangeText={setAdjustedText}
                              keyboardType="decimal-pad"
                              placeholder="6000"
                            />
                          ) : null}
                        </>
                      ) : null}
                      <Input
                        label="Обоснование (увидят стороны)"
                        value={notes}
                        onChangeText={setNotes}
                        multiline
                        numberOfLines={2}
                        placeholder="Почему именно такое решение"
                        textAlignVertical="top"
                      />
                      <Button
                        title={busy ? 'Решаем…' : 'Вынести решение'}
                        variant="primary"
                        disabled={resolveHint !== null || busy}
                        loading={busy}
                        onPress={() => handleResolve(ready.id)}
                      />
                      {resolveHint && outcome !== null ? (
                        <Text variant="caption" color="secondary">
                          {resolveHint}
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                ) : (
                  <Text variant="caption" color="secondary">
                    Кейс рассматривает другой арбитр.
                  </Text>
                )}
                {actionError ? (
                  <Text variant="caption" color="onWarning">
                    {actionError}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <Text variant="body">
                    {ready.resolution
                      ? `Решение: ${DISPUTE_RESOLUTION_LABELS[ready.resolution]}`
                      : 'Спор отклонён'}
                  </Text>
                  {ready.notes ? (
                    <Text variant="caption" color="secondary">
                      «{ready.notes}»
                    </Text>
                  ) : null}
                </View>
              </Card>
            )}

            <Button
              title="К очереди"
              variant="secondary"
              onPress={() => {
                setDetail(null);
                setEvidenceItems([]);
                resetForm();
                void loadQueue();
              }}
            />
          </View>
        ) : null}
      </Screen>
    );
  }

  // ─── Кейс апелляции: пара, жалоба, месяцы часов, решение ─────────────────

  if (appealDetail) {
    const ready = appealDetail.phase === 'ready' ? appealDetail.detail : null;
    const isActive = ready?.status === 'open' || ready?.status === 'under_review';
    const isMine = ready?.assignedTo?.id === user?.id;

    return (
      <Screen scroll={false}>
        <ScreenHeader
          title="Апелляция на блокировку"
          subtitle={ready ? APPEAL_STATUS_LABELS[ready.status] : 'Кейс арбитража'}
          badge={
            ready ? (
              <Badge
                label={APPEAL_STATUS_LABELS[ready.status]}
                variant={isActive ? 'attention' : 'success'}
              />
            ) : undefined
          }
        />
        {appealDetail.phase === 'loading' ? (
          <SkeletonCard />
        ) : appealDetail.phase === 'error' ? (
          <ErrorState
            {...errorContentFor(appealDetail.error)}
            onRetry={() => void loadAppealDetail(appealDetail.id)}
            variant="inline"
          />
        ) : ready ? (
          <View style={{ flex: 1, gap: spacing.md, paddingHorizontal: spacing.lg }}>
            <Card>
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" color="secondary">
                  Пара: {ready.driver.displayName} (водитель) ↔ {ready.seller.displayName}{' '}
                  (продавец)
                </Text>
                <Text variant="caption" color="secondary">
                  Подал: {ready.appellant.displayName} · {formatWhen(ready.openedAt)}
                </Text>
                <Text variant="body">{ready.reason}</Text>
              </View>
            </Card>

            {/* Месяцы часов — главное доказательство: закрылась ли серия честно */}
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Text variant="body" weight="600">
                Часы пары по месяцам
              </Text>
              {ready.months.map((month) => (
                <Card key={month.month}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="body">{month.month}</Text>
                    <Text variant="body" color={month.monthCounted ? 'primary' : 'secondary'}>
                      {formatHours(month.totalMinutes)}
                      {month.monthCounted ? ' · засчитан' : ''}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>

            {/* Переписка кейса (v0.7.0-C, ADR-037): арбитр уточняет
                обстоятельства, не покидая кейс. Служебные заметки — тут. */}
            {ready.messages.length > 0 || isActive ? (
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Text variant="body" weight="600">
                  Переписка
                </Text>
                {ready.messages.map((message) => (
                  <Card key={message.id}>
                    <View style={{ gap: spacing.xs }}>
                      <Text variant="caption" color={message.isInternal ? 'primary' : 'secondary'}>
                        {message.author.displayName} · {formatWhen(message.createdAt)}
                        {message.isInternal ? ' · служебная' : ''}
                      </Text>
                      <Text variant="body">{message.body}</Text>
                    </View>
                  </Card>
                ))}
                {isActive ? (
                  <View style={{ gap: spacing.sm }}>
                    <Input
                      label={
                        appealNoteInternal
                          ? 'Служебная заметка (только арбитрам)'
                          : 'Сообщение паре'
                      }
                      value={appealNote}
                      onChangeText={setAppealNote}
                      multiline
                      numberOfLines={2}
                      placeholder="Уточните обстоятельства у пары"
                      textAlignVertical="top"
                    />
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button
                        title={appealNoteInternal ? 'Служебная' : 'Паре'}
                        variant="secondary"
                        onPress={() => setAppealNoteInternal((prev) => !prev)}
                      />
                      <Button
                        title="Отправить"
                        variant="secondary"
                        disabled={appealNote.trim().length === 0 || busy}
                        loading={busy}
                        onPress={() => handleSendAppealNote(ready.id)}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {isActive ? (
              <View style={{ gap: spacing.md }}>
                {ready.status === 'open' ? (
                  <Button
                    title="Взять в работу"
                    variant="primary"
                    disabled={busy}
                    loading={busy}
                    onPress={() => handleAssignAppeal(ready.id)}
                  />
                ) : isMine ? (
                  <Card>
                    <View style={{ gap: spacing.sm }}>
                      <Text variant="title">Решение</Text>
                      {APPEAL_DECISIONS.map((option) => (
                        <Button
                          key={option}
                          title={APPEAL_DECISION_LABELS[option]}
                          variant={appealDecision === option ? 'primary' : 'secondary'}
                          disabled={busy}
                          onPress={() => setAppealDecision(option)}
                        />
                      ))}
                      <Input
                        label="Обоснование (увидит пара)"
                        value={appealNotes}
                        onChangeText={setAppealNotes}
                        multiline
                        numberOfLines={2}
                        placeholder="Почему именно такое решение"
                        textAlignVertical="top"
                      />
                      <Button
                        title={busy ? 'Решаем…' : 'Вынести решение'}
                        variant="primary"
                        disabled={appealDecision === null || busy}
                        loading={busy}
                        onPress={() => handleResolveAppeal(ready.id)}
                      />
                    </View>
                  </Card>
                ) : (
                  <Text variant="caption" color="secondary">
                    Апелляцию рассматривает другой арбитр.
                  </Text>
                )}
                {actionError ? (
                  <Text variant="caption" color="onWarning">
                    {actionError}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <Text variant="body">{APPEAL_STATUS_LABELS[ready.status]}</Text>
                  {ready.notes ? (
                    <Text variant="caption" color="secondary">
                      «{ready.notes}»
                    </Text>
                  ) : null}
                </View>
              </Card>
            )}

            <Button
              title="К очереди"
              variant="secondary"
              onPress={() => {
                setAppealDetail(null);
                resetAppealForm();
                void loadAppealQueue();
              }}
            />
          </View>
        ) : null}
      </Screen>
    );
  }

  // ─── Очередь (вкладка: споры | апелляции) ────────────────────────────────

  const isAppeals = section === 'appeals';

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Арбитраж"
        subtitle={
          isAppeals ? 'Апелляции блокировок 289-ФЗ: старые сверху' : 'Активные споры: старые сверху'
        }
        badge={
          !isAppeals && queue.phase === 'ready' && queue.items.length > 0 ? (
            <Badge label={`В работе: ${queue.items.length}`} variant="attention" />
          ) : isAppeals && appealQueue.phase === 'ready' && appealQueue.items.length > 0 ? (
            <Badge label={`В работе: ${appealQueue.items.length}`} variant="attention" />
          ) : undefined
        }
      />

      {/* Переключатель вкладок: споры | апелляции (ADR-035) */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Споры"
            variant={!isAppeals ? 'primary' : 'secondary'}
            size="md"
            onPress={() => setSection('disputes')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Апелляции 289-ФЗ"
            variant={isAppeals ? 'primary' : 'secondary'}
            size="md"
            onPress={() => setSection('appeals')}
          />
        </View>
      </View>

      {!isAppeals ? (
        queue.phase === 'loading' ? (
          <SkeletonCard />
        ) : queue.phase === 'error' ? (
          <ErrorState {...errorContentFor(queue.error)} onRetry={() => void loadQueue()} />
        ) : queue.items.length === 0 ? (
          <EmptyState
            illustration="box"
            title="Очередь пуста"
            description="Активных споров нет. Новые кейсы появятся здесь автоматически."
          />
        ) : (
          <View style={{ flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {queue.items.map((item) => (
              <Pressable key={item.id} onPress={() => void loadDetail(item.id)}>
                <Card>
                  <View style={{ gap: spacing.sm }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text variant="title">{item.subject}</Text>
                      <Badge label={DISPUTE_STATUS_LABELS[item.status]} variant="attention" />
                    </View>
                    <Text variant="caption" color="secondary">
                      {DISPUTE_TYPE_LABELS[item.type]} · {item.firstParty.displayName} ↔{' '}
                      {item.secondParty.displayName}
                    </Text>
                    <Text variant="caption" color="secondary">
                      С {formatWhen(item.openedAt)} · сообщений: {item.messagesCount}
                      {item.assignedTo ? ` · арбитр: ${item.assignedTo.displayName}` : ''}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )
      ) : appealQueue.phase === 'loading' ? (
        <SkeletonCard />
      ) : appealQueue.phase === 'error' ? (
        <ErrorState
          {...errorContentFor(appealQueue.error)}
          onRetry={() => void loadAppealQueue()}
        />
      ) : appealQueue.items.length === 0 ? (
        <EmptyState
          illustration="box"
          title="Апелляций нет"
          description="Обжалования блокировок 289-ФЗ появятся здесь, когда пары их подадут."
        />
      ) : (
        <View style={{ flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {appealQueue.items.map((item) => (
            <Pressable key={item.id} onPress={() => void loadAppealDetail(item.id)}>
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="title" numberOfLines={1} style={{ flex: 1 }}>
                      {item.driver.displayName} ↔ {item.seller.displayName}
                    </Text>
                    <Badge label={APPEAL_STATUS_LABELS[item.status]} variant="attention" />
                  </View>
                  <Text variant="caption" color="secondary" numberOfLines={2}>
                    {item.reason}
                  </Text>
                  <Text variant="caption" color="secondary">
                    Подал: {item.appellant.displayName} · с {formatWhen(item.openedAt)}
                    {item.assignedTo ? ` · арбитр: ${item.assignedTo.displayName}` : ''}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
