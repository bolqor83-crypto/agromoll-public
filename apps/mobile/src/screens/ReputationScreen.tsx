/**
 * Экран «Мой рейтинг» (v0.5.0, подэтап A, ADR-013).
 *
 * Публичный рейтинг — производная от завершённых сделок и долгов:
 *   - крупная карточка score (или подсказка «Сделайте ещё N сделок»,
 *     если порог минимальных данных не достигнут);
 *   - счётчики: сделки / споры / авто-подтверждения;
 *   - таймлайн последних 20 событий журнала (что двигало рейтинг).
 *
 * Данные — свежий расчёт сервера (GET /reputation/me), офлайн-режим —
 * как у остальных экранов чтения: ошибка сети показывает EmptyState.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  Card,
  EmptyState,
  Icon,
  AnimatedNumber,
  ProgressBar,
  PullToRefreshScrollView,
  Screen,
  Skeleton,
  spacing,
  Text,
} from '@agromoll/ui';
import type { MyReputationDto, ReputationActionType } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api } from '@/lib/api';
import { toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';

/** Подписи и иконки событий журнала рейтинга. */
const ACTION_META: Record<
  ReputationActionType,
  {
    label: string;
    icon: 'checkmark-circle-outline' | 'alert-circle-outline' | 'swap-horizontal-outline' | 'time-outline' | 'shield-checkmark-outline';
    variant: 'success' | 'attention' | 'neutral';
  }
> = {
  deal_confirmed: {
    label: 'Сделка подтверждена',
    icon: 'checkmark-circle-outline',
    variant: 'success',
  },
  dispute_opened: { label: 'Открыт спор', icon: 'alert-circle-outline', variant: 'attention' },
  dispute_resolved: {
    label: 'Спор разрешён',
    icon: 'swap-horizontal-outline',
    variant: 'neutral',
  },
  auto_confirmed: {
    label: 'Авто-подтверждение',
    icon: 'time-outline',
    variant: 'neutral',
  },
  penalty_applied: {
    label: 'Анти-накрутка: вес снижен',
    icon: 'shield-checkmark-outline',
    variant: 'attention',
  },
};

/** Человекочитаемый контекст события (reason из журнала). */
const REASON_LABELS: Record<string, string> = {
  ok: 'качество: всё в порядке',
  minor_issue: 'качество: мелкие проблемы',
  buyer_accepted: 'вы подтвердили приёмку',
  auto_confirm: 'приёмка закрыта автоматически',
  delivery_disputed: 'спор по качеству поставки',
  debt_settled: 'долг погашен',
  debt_disputed: 'спор по долгу',
  debt_resolved_mutually: 'стороны договорились',
  pair_deals_capped: 'слишком много сделок с одним контрагентом',
};

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReputationScreen() {
  const [data, setData] = useState<MyReputationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const reputation = await api.myReputation();
      setData(reputation);
      setError(null);
    } catch (err) {
      const apiError = toApiError(err);
      setError(apiError.message);
      logger.warn('reputation', 'не удалось загрузить рейтинг', { error: apiError.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  const hasRating = data !== null && data.score !== null;

  return (
    <Screen scroll={false}>
      <ScreenHeader title="Мой рейтинг" subtitle="Как рынок видит ваши сделки и долги" />

      {loading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={148} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : error !== null && data === null ? (
        <EmptyState
          illustration="box"
          title="Рейтинг недоступен"
          description={error}
          action={{ label: 'Повторить', onPress: () => void load() }}
        />
      ) : data !== null ? (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={handleRefresh} style={{ flex: 1 }}>
          <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
            {/* Крупная карточка score / прогресс до рейтинга */}
            <Animated.View entering={FadeInDown.springify().damping(18)}>
              <Card style={{ gap: spacing.md }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <View style={{ gap: 2 }}>
                    {/* v0.6.1-E2 (ADR-027): рейтинг «пробегает» к новому
                        значению — сделка сдвинула цифру, и это видно. */}
                    {hasRating ? (
                      <Text variant="title">
                        <AnimatedNumber
                          value={data.score ?? 0}
                          format={(n) => n.toFixed(1)}
                          variant="title"
                        />{' '}
                        из 5
                      </Text>
                    ) : (
                      <Text variant="title">Рейтинг ещё не сформирован</Text>
                    )}
                    <Text variant="caption" color="secondary">
                      {hasRating
                        ? 'Публичный рейтинг по завершённым сделкам'
                        : 'Сделайте ещё несколько сделок — и рынок увидите вашу цифру'}
                    </Text>
                  </View>
                  <Icon
                    name={hasRating ? 'star' : 'star-outline'}
                    size={40}
                    color={hasRating && data.score! >= 4 ? 'primary' : 'warning'}
                  />
                </View>

                {hasRating ? (
                  <ProgressBar progress={(data.score ?? 0) / 5}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text variant="caption" color="secondary">
                        0
                      </Text>
                      <Text variant="caption" color="secondary">
                        5
                      </Text>
                    </View>
                  </ProgressBar>
                ) : (
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="body" color="secondary">
                      {data.dealsToRating > 0
                        ? `Сделайте ещё ${data.dealsToRating} ${data.dealsToRating === 1 ? 'сделку' : 'сделок'}, чтобы получить рейтинг`
                        : 'Рейтинг появится после следующей завершённой сделки'}
                    </Text>
                    <Text variant="caption" color="muted">
                      Новичков без рейтинга не наказываем: цифра появляется, когда данных достаточно.
                    </Text>
                  </View>
                )}
              </Card>
            </Animated.View>

            {/* Счётчики */}
            <Animated.View entering={FadeInDown.springify().damping(18).delay(60)}>
              <Card style={{ gap: spacing.sm }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Counter label="Сделки" value={data.dealsCount} />
                  <Counter label="Споры" value={data.disputesCount} />
                  <Counter label="Авто-подтв." value={data.autoConfirmedCount} />
                </View>
                <Text variant="caption" color="muted">
                  Авто-подтверждения весят меньше явных: рынок ценит живое участие.
                </Text>
              </Card>
            </Animated.View>

            {/* Таймлайн событий */}
            <View style={{ gap: spacing.sm }}>
              <Text variant="body" weight="600">
                История рейтинга
              </Text>
              {data.events.length === 0 ? (
                <Card>
                  <Text variant="body" color="secondary">
                    Пока пусто: завершите первую сделку или закройте долг — события появятся здесь.
                  </Text>
                </Card>
              ) : (
                data.events.map((event, index) => {
                  const meta = ACTION_META[event.action];
                  const reason = event.reason ? REASON_LABELS[event.reason] ?? event.reason : null;
                  return (
                    <Animated.View
                      key={event.id}
                      entering={FadeInDown.springify().damping(18).delay(Math.min(index * 40, 320))}
                    >
                      <Card style={{ gap: spacing.xs }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: spacing.sm,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                            <Icon
                              name={meta.icon}
                              size={20}
                              color={meta.variant === 'success' ? 'primary' : meta.variant === 'attention' ? 'warning' : 'secondary'}
                            />
                            <Text variant="body" weight="600" style={{ flex: 1 }}>
                              {meta.label}
                            </Text>
                          </View>
                          <Badge
                            label={`${event.delta > 0 ? '+' : ''}${event.delta.toFixed(1)}`}
                            variant={event.delta > 0 ? 'success' : event.delta < 0 ? 'attention' : 'neutral'}
                          />
                        </View>
                        <Text variant="caption" color="secondary">
                          {reason ? `${reason} · ` : ''}
                          {formatEventTime(event.createdAt)}
                        </Text>
                      </Card>
                    </Animated.View>
                  );
                })
              )}
            </View>
          </View>
        </PullToRefreshScrollView>
      ) : null}

      {error !== null && data !== null ? (
        <Card>
          <Text variant="caption" color="onWarning">
            Не удалось обновить: {error}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

/** Счётчик в строке статистики. */
function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 2, flex: 1 }}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}
