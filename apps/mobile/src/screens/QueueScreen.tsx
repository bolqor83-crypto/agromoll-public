/**
 * Экран «Очередь» (v0.3.0): прозрачность офлайн-ядра для пользователя.
 *
 * Показывает все операции локального outbox с их состояниями,
 * позволяет вручную повторить безнадёжные, синхронизироваться
 * и выйти из аккаунта (очередь при этом очищается — операции
 * одного пользователя не утекают в сессию другого).
 */
import { useCallback } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Badge,
  Button,
  EmptyState,
  PullToRefreshScrollView,
  Screen,
  spacing,
  Text,
} from '@agromoll/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useOutboxStore } from '@/store/outbox';
import { useAuthStore } from '@/store/auth';
import type { OutboxRecord, OutboxState } from '@/lib/outbox/types';

/** Пилюля состояния операции: цвет и подпись. */
const STATE_BADGES: Record<
  OutboxState,
  { label: string; variant: 'success' | 'attention' | 'neutral' }
> = {
  pending: { label: 'В очереди', variant: 'neutral' },
  processing: { label: 'Отправляется', variant: 'neutral' },
  retrying: { label: 'Повтор позже', variant: 'attention' },
  conflicted: { label: 'Конфликт', variant: 'attention' },
  permanently_failed: { label: 'Не удалось', variant: 'attention' },
  completed: { label: 'Готово', variant: 'success' },
};

const OPERATION_LABELS: Record<string, string> = {
  create_booking: 'Создание брони',
  cancel_booking: 'Отмена брони',
  confirm_booking: 'Подтверждение брони',
  counter_offer_booking: 'Корректировка брони',
  accept_counter_booking: 'Принятие корректировки',
  create_debt: 'Запись долга',
  confirm_delivery: 'Подтверждение доставки',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function OperationRow({ record }: { record: OutboxRecord }) {
  const retryOperation = useOutboxStore((s) => s.retryOperation);
  const badge = STATE_BADGES[record.state];
  const label = OPERATION_LABELS[record.operationType] ?? record.operationType;
  const canRetry =
    record.state === 'permanently_failed' ||
    record.state === 'retrying' ||
    record.state === 'pending';

  return (
    <View style={{ gap: spacing.xs, paddingBottom: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <Text variant="body" weight="600">
          {label}
        </Text>
        <Badge label={badge.label} variant={badge.variant} />
      </View>
      <Text variant="caption" color="secondary">
        {formatTime(record.createdAt)} · попыток: {record.retries}
        {record.state === 'retrying' && record.nextAttemptAt
          ? ` · следующая в ${formatTime(record.nextAttemptAt)}`
          : ''}
      </Text>
      {record.lastError ? (
        <Text variant="caption" color="onWarning">
          {record.lastError}
        </Text>
      ) : null}
      {canRetry ? (
        <Button
          title="Повторить сейчас"
          variant="secondary"
          size="md"
          onPress={() => void retryOperation(record.clientUuid)}
        />
      ) : null}
    </View>
  );
}

export default function QueueScreen() {
  const router = useRouter();
  const queue = useOutboxStore((s) => s.queue);
  const refreshQueue = useOutboxStore((s) => s.refreshQueue);
  const runSync = useOutboxStore((s) => s.runSync);
  const syncing = useOutboxStore((s) => s.syncing);
  const signOut = useAuthStore((s) => s.signOut);

  const handleRefresh = useCallback((): void => {
    void refreshQueue();
    void runSync();
  }, [refreshQueue, runSync]);

  const handleSignOut = useCallback((): void => {
    Alert.alert('Выйти из аккаунта?', 'Локальная очередь операций будет очищена.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          // signOut сам чистит токены и локальную очередь (критично:
          // операции не должны утечь в чужую сессию — см. ADR-006)
          void signOut().then(() => router.replace('/auth'));
        },
      },
    ]);
  }, [signOut, router]);

  return (
    <Screen scroll={false}>
      <ScreenHeader title="Очередь" subtitle="Операции, ждущие сети, и их состояние" />
      {queue.length === 0 ? (
        <EmptyState
          illustration="box"
          title="Очередь пуста"
          description="Все операции отправлены. Здесь появятся действия, сделанные без сети."
          action={{ label: 'Синхронизировать', onPress: handleRefresh }}
        />
      ) : (
        <PullToRefreshScrollView refreshing={syncing} onRefresh={handleRefresh} style={{ flex: 1 }}>
          <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
            {queue.map((record) => (
              <OperationRow key={record.clientUuid} record={record} />
            ))}
          </View>
        </PullToRefreshScrollView>
      )}
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        <Button
          title="Синхронизировать"
          variant="secondary"
          size="md"
          onPress={handleRefresh}
          loading={syncing}
        />
        <Button title="Выйти из аккаунта" variant="ghost" size="md" onPress={handleSignOut} />
      </View>
    </Screen>
  );
}
