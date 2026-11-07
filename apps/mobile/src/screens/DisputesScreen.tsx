/**
 * «Споры» (v0.6.0-C ADR-033 → v0.7.0-B ADR-036): мои кейсы арбитража.
 *
 * Список кейсов (где я сторона) → детали: переписка (свои сообщения
 * можно отправлять, пока кейс активен), доказательства (фото — прямо
 * с устройства: сжатие → presigned S3 → fallback data:-URL) и решение.
 * Статусная машина — как у всех экранов (ADR-026): skeleton → данные
 * или честная ошибка, без фейков.
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
  DISPUTE_RESOLUTION_LABELS,
  DISPUTE_STATUS_LABELS,
  DISPUTE_TYPE_LABELS,
} from '@agromoll/types';
import type { DisputeDetailDto, DisputeDto, DisputeEvidenceItemDto } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, isInvalidResponseError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { pickAndCompressPhoto } from '@/lib/media/photo';
import { uploadDisputeEvidence } from '@/lib/media/evidence-upload';
/** Дата-время кейса: «07.11 14:30» — день важнее секунд. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day}.${month} ${time}`;
}

/** Конечный автомат экрана. */
type DisputesState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; items: DisputeDto[] };

/** Детали выбранного кейса. */
type DetailState =
  | { phase: 'loading'; id: string }
  | { phase: 'error'; id: string; error: unknown }
  | { phase: 'ready'; detail: DisputeDetailDto };

/** Бейдж статуса кейса: янтарный открыт, зелёный закрыт. */
function statusBadge(status: DisputeDto['status']) {
  const variant = status === 'open' || status === 'under_review' ? 'attention' : 'success';
  return <Badge label={DISPUTE_STATUS_LABELS[status]} variant={variant} />;
}

/** Сообщения об ошибках загрузки доказательства — без жаргона. */
const EVIDENCE_ERROR_MESSAGES: Record<string, string> = {
  too_large_for_fallback: 'Фото больше 500 КБ — не удалось загрузить, попробуйте другое',
  upload_failed: 'Не удалось прикрепить фото — попробуйте ещё раз',
  network: 'Нет связи — фото не отправлено, попробуйте позже',
};

export default function DisputesScreen() {
  const [state, setState] = useState<DisputesState>({ phase: 'loading' });
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Доказательства с ссылками (v0.7.0-B): загружаются отдельным запросом
  // после деталей — превью не блокируют переписку.
  const [evidenceItems, setEvidenceItems] = useState<DisputeEvidenceItemDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await api.myDisputes();
      setState({ phase: 'ready', items: list.items });
    } catch (error) {
      logger.warn('disputes', 'список споров не загрузился', { error: String(error) });
      setState((prev) =>
        prev.phase === 'ready' ? prev : { phase: 'error', error },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (disputeId: string): Promise<void> => {
    setDetail({ phase: 'loading', id: disputeId });
    try {
      const caseDetail = await api.dispute(disputeId);
      setDetail({ phase: 'ready', detail: caseDetail });
      // Ссылки на файлы — вторым запросом (ADR-036): сбой не ломает кейс.
      try {
        const evidence = await api.disputeEvidence(disputeId);
        setEvidenceItems(evidence.items);
      } catch (err) {
        logger.warn('disputes', 'ссылки на доказательства не загрузились', {
          disputeId,
          error: String(err),
        });
        setEvidenceItems([]);
      }
    } catch (error) {
      logger.warn('disputes', 'кейс не загрузился', { disputeId, error: String(error) });
      setDetail({ phase: 'error', id: disputeId, error });
    }
  }, []);

  /** Загрузить фото-доказательство (сжатие → S3/ fallback, ADR-036). */
  const attachPhoto = useCallback(async (): Promise<void> => {
    if (!detail || detail.phase !== 'ready' || uploading) {
      return;
    }
    const photo = await pickAndCompressPhoto();
    if (!photo) {
      return; // отмена выбора — не ошибка
    }
    setUploading(true);
    setUploadError(null);
    const result = await uploadDisputeEvidence(detail.detail.id, photo);
    if (result.ok) {
      await loadDetail(detail.detail.id);
    } else {
      setUploadError(EVIDENCE_ERROR_MESSAGES[result.error ?? 'network'] ?? EVIDENCE_ERROR_MESSAGES.network);
    }
    setUploading(false);
  }, [detail, uploading, loadDetail]);

  const sendReply = useCallback(async (): Promise<void> => {
    if (!detail || detail.phase !== 'ready' || reply.trim().length === 0 || sending) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await api.sendDisputeMessage(detail.detail.id, reply.trim());
      setReply('');
      await loadDetail(detail.detail.id);
    } catch (error) {
      setSendError(
        isInvalidResponseError(error) ? 'Сервер ответил неожиданно' : 'Не отправилось',
      );
    } finally {
      setSending(false);
    }
  }, [detail, reply, sending, loadDetail]);

  // ─── Детали кейса ─────────────────────────────────────────────────────────

  if (detail) {
    const active =
      detail.phase === 'ready' &&
      (detail.detail.status === 'open' || detail.detail.status === 'under_review');
    return (
      <Screen scroll={false}>
        <ScreenHeader
          title={detail.phase === 'ready' ? detail.detail.subject : 'Спор'}
          subtitle="Кейс арбитража"
          badge={detail.phase === 'ready' ? statusBadge(detail.detail.status) : undefined}
        />
        {detail.phase === 'loading' ? (
          <SkeletonCard />
        ) : detail.phase === 'error' ? (
          <ErrorState
            {...errorContentFor(detail.error)}
            onRetry={() => void loadDetail(detail.id)}
            variant="inline"
          />
        ) : (
          <View style={{ flex: 1, gap: spacing.md, paddingHorizontal: spacing.lg }}>
            {/* Стороны и решение */}
            <Card>
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="caption" color="secondary">
                    {DISPUTE_TYPE_LABELS[detail.detail.type]} · открыто{' '}
                    {formatWhen(detail.detail.openedAt)}
                  </Text>
                  {statusBadge(detail.detail.status)}
                </View>
                <Text variant="body">
                  {detail.detail.firstParty.displayName} ↔ {detail.detail.secondParty.displayName}
                </Text>
                {detail.detail.resolution ? (
                  <Text variant="body" color="secondary">
                    Решение: {DISPUTE_RESOLUTION_LABELS[detail.detail.resolution]}
                  </Text>
                ) : null}
                {detail.detail.notes ? (
                  <Text variant="caption" color="secondary">
                    «{detail.detail.notes}»
                  </Text>
                ) : null}
                {detail.detail.assignedTo ? (
                  <Text variant="caption" color="secondary">
                    Арбитр: {detail.detail.assignedTo.displayName}
                  </Text>
                ) : null}
              </View>
            </Card>

            {/* Переписка */}
            <View style={{ flex: 1, gap: spacing.sm }}>
              {detail.detail.messages.map((message) => (
                <Card key={message.id}>
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="caption" color="secondary">
                      {message.author.displayName} · {formatWhen(message.createdAt)}
                      {message.isInternal ? ' · служебная заметка' : ''}
                    </Text>
                    <Text variant="body">{message.body}</Text>
                  </View>
                </Card>
              ))}
              {/* Доказательства (v0.7.0-B): превью по ссылкам,
                  без ссылок — имена файлов (не ломаем старый UX). */}
              {detail.detail.evidence.length > 0 ? (
                <Card>
                  <View style={{ gap: spacing.sm }}>
                    <Text variant="caption" color="secondary">
                      Доказательства · {detail.detail.evidence.length}
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
                      {evidenceItems.length < detail.detail.evidence.length ? (
                        <Text variant="caption" color="secondary">
                          {detail.detail.evidence
                            .filter(
                              (meta) => !evidenceItems.some((item) => item.id === meta.id),
                            )
                            .map((meta) => meta.fileName)
                            .join(', ')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              ) : null}
            </View>

            {/* Ответ и фото в активном кейсе */}
            {active ? (
              <View style={{ gap: spacing.sm }}>
                <Input
                  label="Сообщение арбитру и второй стороне"
                  value={reply}
                  onChangeText={setReply}
                  multiline
                  numberOfLines={3}
                  placeholder="Опишите свою позицию по спору"
                  textAlignVertical="top"
                />
                {sendError ? (
                  <Text variant="caption" color="onWarning">
                    {sendError}
                  </Text>
                ) : null}
                <Button
                  title={sending ? 'Отправляем…' : 'Отправить'}
                  variant="primary"
                  disabled={reply.trim().length === 0 || sending}
                  loading={sending}
                  onPress={() => void sendReply()}
                />
                <Button
                  title={uploading ? 'Загружаем фото…' : 'Приложить фото'}
                  variant="secondary"
                  disabled={uploading}
                  loading={uploading}
                  onPress={() => void attachPhoto()}
                />
                {uploadError ? (
                  <Text variant="caption" color="onWarning">
                    {uploadError}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Button
              title="К списку споров"
              variant="secondary"
              onPress={() => {
                setDetail(null);
                setReply('');
                setSendError(null);
                setEvidenceItems([]);
                setUploadError(null);
                void load();
              }}
            />
          </View>
        )}
      </Screen>
    );
  }

  // ─── Список кейсов ────────────────────────────────────────────────────────

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Споры"
        subtitle="Кейсы, где вы сторона: спор решает нейтральный арбитр"
      />
      {state.phase === 'loading' ? (
        <SkeletonCard />
      ) : state.phase === 'error' ? (
        <ErrorState {...errorContentFor(state.error)} onRetry={() => void load()} />
      ) : state.items.length === 0 ? (
        <EmptyState
          illustration="box"
          title="Споров нет"
          description="Если сделка пойдёт не так, откройте спор из карточки брони или долга — его рассмотрит нейтральный арбитр рынка."
        />
      ) : (
        <View style={{ flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {state.items.map((item) => (
            <Pressable key={item.id} onPress={() => void loadDetail(item.id)}>
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="title">{item.subject}</Text>
                    {statusBadge(item.status)}
                  </View>
                  <Text variant="caption" color="secondary">
                    {DISPUTE_TYPE_LABELS[item.type]} · {item.firstParty.displayName} ↔{' '}
                    {item.secondParty.displayName}
                  </Text>
                  <Text variant="caption" color="secondary">
                    Открыто {formatWhen(item.openedAt)} · сообщений: {item.messagesCount}
                    {item.evidenceCount > 0 ? ` · доказательств: ${item.evidenceCount}` : ''}
                  </Text>
                  {item.resolution ? (
                    <Text variant="body" color="secondary">
                      {DISPUTE_RESOLUTION_LABELS[item.resolution]}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
