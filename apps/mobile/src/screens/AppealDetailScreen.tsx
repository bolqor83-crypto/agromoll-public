/**
 * Детали апелляции 289-ФЗ (v0.7.0-C, ADR-037) — экран стороны пары.
 *
 * Таймлайн переписки с арбитром (как DisputeScreen у споров): водитель
 * или продавец пары отвечает на вопросы арбитра, не уходя из карточки
 * блокировки. История месяцев часов — доказательство, она же объясняет
 * паре, откуда взялась блокировка. Статусная машина — как везде
 * (ADR-026): skeleton → данные или честная ошибка.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Screen,
  SkeletonCard,
  spacing,
  Text,
} from '@agromoll/ui';
import { APPEAL_STATUS_LABELS } from '@agromoll/types';
import type { AppealDetailDto } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, isInvalidResponseError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';

/** Дата-время сообщения: «07.11 14:30». */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day}.${month} ${time}`;
}

/** Конечный автомат экрана. */
type AppealState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; detail: AppealDetailDto };

export default function AppealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<AppealState>({ phase: 'loading' });
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const detail = await api.appeal(id);
      setState({ phase: 'ready', detail });
    } catch (error) {
      logger.warn('appeal', 'кейс не загрузился', { id, error: String(error) });
      setState((prev) => (prev.phase === 'ready' ? prev : { phase: 'error', error }));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReply = useCallback(async (): Promise<void> => {
    if (state.phase !== 'ready' || reply.trim().length === 0 || sending) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await api.sendAppealMessage(state.detail.id, reply.trim());
      setReply('');
      await load();
    } catch (error) {
      setSendError(
        isInvalidResponseError(error) ? 'Сервер ответил неожиданно' : 'Не отправилось',
      );
    } finally {
      setSending(false);
    }
  }, [state, reply, sending, load]);

  if (state.phase === 'loading') {
    return (
      <Screen scroll={false}>
        <ScreenHeader title="Апелляция" subtitle="Кейс арбитража 289-ФЗ" />
        <SkeletonCard />
      </Screen>
    );
  }

  if (state.phase === 'error') {
    return (
      <Screen scroll={false}>
        <ScreenHeader title="Апелляция" subtitle="Кейс арбитража 289-ФЗ" />
        <ErrorState {...errorContentFor(state.error)} onRetry={() => void load()} />
      </Screen>
    );
  }

  const detail = state.detail;
  const active = detail.status === 'open' || detail.status === 'under_review';

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Апелляция"
        subtitle="Обжалование блокировки пары по 289-ФЗ"
        badge={
          <Badge
            label={APPEAL_STATUS_LABELS[detail.status]}
            variant={active ? 'attention' : 'success'}
          />
        }
      />
      <View style={{ flex: 1, gap: spacing.md, paddingHorizontal: spacing.lg }}>
        {/* Пара и суть жалобы */}
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" color="secondary">
              Пара: {detail.driver.displayName} ↔ {detail.seller.displayName}
            </Text>
            <Text variant="caption" color="secondary">
              Подал: {detail.appellant.displayName} · {formatWhen(detail.openedAt)}
            </Text>
            <Text variant="body">{detail.reason}</Text>
            {detail.assignedTo ? (
              <Text variant="caption" color="secondary">
                Арбитр: {detail.assignedTo.displayName}
              </Text>
            ) : null}
            {detail.notes ? (
              <Text variant="body" color="secondary">
                Решение: {detail.notes}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* История месяцев часов — доказательство (ADR-035). */}
        {detail.months.length > 0 ? (
          <Card>
            <View style={{ gap: spacing.xs }}>
              <Text variant="caption" color="secondary">
                Часы пары по месяцам (доказательство)
              </Text>
              {detail.months.slice(0, 6).map((month) => (
                <Text key={month.month} variant="caption" color="secondary">
                  {month.month}: {Math.round(month.totalMinutes / 60)} ч
                  {month.monthCounted ? ' · засчитан' : ''}
                </Text>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Переписка (ADR-037): служебных заметок тут не бывает —
            сервер отдаёт паре только публичные. */}
        <View style={{ flex: 1, gap: spacing.sm }}>
          {detail.messages.map((message) => (
            <Card key={message.id}>
              <View style={{ gap: spacing.xs }}>
                <Text variant="caption" color="secondary">
                  {message.author.displayName} · {formatWhen(message.createdAt)}
                </Text>
                <Text variant="body">{message.body}</Text>
              </View>
            </Card>
          ))}
        </View>

        {/* Ответ в активном кейсе */}
        {active ? (
          <View style={{ gap: spacing.sm }}>
            <Input
              label="Сообщение арбитру"
              value={reply}
              onChangeText={setReply}
              multiline
              numberOfLines={3}
              placeholder="Ответьте на вопросы арбитра"
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
          </View>
        ) : null}

        <Button title="Назад" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
