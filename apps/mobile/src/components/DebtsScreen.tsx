/**
 * DebtsScreen — экран «Долги» (v0.4.0, ADR-010), общий для покупателя
 * и продавца (тонкая обёртка-роут у каждой роли).
 *
 * Две секции: «Должны мне» (я кредитор) и «Я должен» (я дебитор) —
 * роле-независимый взгляд: любой участник рынка может быть с обеих
 * сторон. Создание долга — только кредиторская позиция («отпустил
 * в долг»), контрагенты — те, с кем уже были сделки.
 *
 * Мутации идут через офлайн-ядро (ADR-006): создание/погашение/спор/
 * разрешение работают без сети, оптимистичные статусы подставляются
 * из debtOverrides, псевдо-карточки — из pendingDebtCreates. Напоминание —
 * прямой вызов (осмысленно только онлайн, кулдаун 24 ч считает сервер).
 *
 * Платформа не является платёжным агентом — дисклеймер в шапке и в форме.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import {
  Badge,
  Button,
  EmptyState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  Text,
  spacing,
} from '@agromoll/ui';
import type { CounterpartyDto, DebtDto, DebtStatus } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DebtCard } from '@/components/DebtCard';
import { CreateDebtModal } from '@/components/CreateDebtModal';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { formatMoney } from '@/lib/format';
import {
  disputeDebtMutation,
  remindDebt,
  resolveDebtMutation,
  settleDebtMutation,
} from '@/lib/outbox/debt-mutations';
import { useAuthStore } from '@/store/auth';
import { useOutboxStore } from '@/store/outbox';
import { DEMO_DEBTS } from '@/lib/demo-data';

type DebtsState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'ready'; debts: DebtDto[]; demo: boolean };

export function DebtsScreen() {
  const [state, setState] = useState<DebtsState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [counterparties, setCounterparties] = useState<CounterpartyDto[]>([]);
  const [counterpartiesLoading, setCounterpartiesLoading] = useState(false);

  const viewerId = useAuthStore((s) => s.user?.id ?? '');
  const version = useOutboxStore((s) => s.version);
  const runSync = useOutboxStore((s) => s.runSync);
  const debtOverrides = useOutboxStore((s) => s.debtOverrides);
  const pendingDebtCreates = useOutboxStore((s) => s.pendingDebtCreates);

  const load = useCallback(async (): Promise<void> => {
    try {
      const debts = await api.debts();
      setState({ phase: 'ready', debts, demo: false });
    } catch (error) {
      if (isInvalidResponseError(error)) {
        setState({ phase: 'invalid' });
        return;
      }
      logger.warn('debts', 'API недоступен, показываем демо-долги', { error: String(error) });
      setState({ phase: 'ready', debts: DEMO_DEBTS, demo: true });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const loadCounterparties = useCallback(async (): Promise<void> => {
    setCounterpartiesLoading(true);
    try {
      setCounterparties(await api.debtCounterparties());
    } catch {
      setCounterparties([]); // форма честно скажет «пока нет контрагентов»
    } finally {
      setCounterpartiesLoading(false);
    }
  }, []);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void runSync();
    void load().finally(() => setRefreshing(false));
  }, [load, runSync]);

  /** Оптимистичный статус: серверный + локальный override из очереди. */
  const merged = useMemo<(DebtDto & { pending?: boolean })[]>(() => {
    if (state.phase !== 'ready') {
      return [];
    }
    return state.debts.map((debt) => {
      const override = debtOverrides[debt.id];
      return override
        ? { ...debt, status: override.status, pending: true }
        : debt;
    });
  }, [state, debtOverrides]);

  const owedToMe = merged.filter((d) => d.creditorId === viewerId);
  const iOwe = merged.filter((d) => d.debtorId === viewerId && d.creditorId !== viewerId);
  const activeOverdue = merged.filter((d) => d.status === 'active' && d.isOverdue).length;

  // ─── Действия ───────────────────────────────────────────────────────────

  const handleSettle = useCallback(
    (debt: DebtDto): void => {
      void settleDebtMutation(debt.id);
    },
    [],
  );

  const handleDispute = useCallback((debt: DebtDto): void => {
    void disputeDebtMutation(debt.id);
  }, []);

  const handleResolve = useCallback((debt: DebtDto): void => {
    // Оптимистичный статус: второе подтверждение закрывает спор, первое —
    // оставляет открытым (ждём другую сторону).
    const closes =
      debt.resolveRequestedById !== null && debt.resolveRequestedById !== viewerId;
    void resolveDebtMutation(debt.id, (closes ? 'settled' : 'disputed') as DebtStatus);
  }, [viewerId]);

  const handleRemind = useCallback((debt: DebtDto): void => {
    void remindDebt(debt.id)
      .then(() => {
        // Сервер записал напоминание: перечитываем — canRemind станет false.
        void load();
      })
      .catch((error: unknown) => {
        const apiError = toApiError(error);
        Alert.alert('Напоминание', apiError.hint ?? apiError.message);
      });
  }, [load]);

  // ─── Рендер ─────────────────────────────────────────────────────────────

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Долги"
        subtitle="Учёт договорённостей · платформа не платёжный агент"
        badge={
          state.phase === 'ready' && state.demo ? (
            <Badge label="Демо-данные · API недоступен" variant="attention" />
          ) : activeOverdue > 0 ? (
            <Badge label={`Просрочено: ${activeOverdue}`} variant="attention" />
          ) : undefined
        }
      />

      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md, padding: spacing.lg }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.phase === 'invalid' ? (
        <EmptyState
          illustration="box"
          title="Не удалось загрузить"
          description="Данные пришли в неожиданном формате. Потяните вниз, чтобы попробовать ещё раз."
          action={{ label: 'Попробовать ещё раз', onPress: handleRefresh }}
        />
      ) : (
        <PullToRefreshScrollView
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.lg,
            paddingBottom: spacing.xxl,
          }}
        >
          <Section
            title="Должны мне"
            subtitle={summarize(owedToMe)}
            empty="Пока тихо: никто вам не должен. Записывайте «отпустил в долг» после отгрузки."
            emptyActionLabel="Записать долг"
            onEmptyAction={() => {
              void loadCounterparties();
              setCreateVisible(true);
            }}
          >
            {owedToMe.map((debt) => (
              <DebtCard
                key={debt.id}
                debt={debt}
                viewerId={viewerId}
                pending={debt.pending}
                onSettle={handleSettle}
                onDispute={handleDispute}
                onResolve={handleResolve}
                onRemind={handleRemind}
              />
            ))}
            {/* Офлайн-созданные долги — псевдо-карточки до подтверждения. */}
            {Object.entries(pendingDebtCreates).map(([clientUuid, pending]) => (
              <PendingDebtCard key={clientUuid} pending={pending} />
            ))}
          </Section>

          <Section
            title="Я должен"
            subtitle={summarize(iOwe)}
            empty="Здесь появятся ваши долги — когда контрагент запишет отгрузку в долг."
          >
            {iOwe.map((debt) => (
              <DebtCard
                key={debt.id}
                debt={debt}
                viewerId={viewerId}
                pending={debt.pending}
                onSettle={handleSettle}
                onDispute={handleDispute}
                onResolve={handleResolve}
                onRemind={handleRemind}
              />
            ))}
          </Section>
        </PullToRefreshScrollView>
      )}

      {/* Кнопка создания — у нижней кромки контента, вне скролла. */}
      {state.phase === 'ready' && !state.demo ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
          <Button
            title="Записать долг"
            variant="primary"
            size="lg"
            onPress={() => {
              void loadCounterparties();
              setCreateVisible(true);
            }}
          />
        </View>
      ) : null}

      <CreateDebtModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        counterparties={counterparties}
        counterpartiesLoading={counterpartiesLoading}
      />
    </Screen>
  );
}

/** Секция списка с заголовком и пустым состоянием. */
function Section({
  title,
  subtitle,
  empty,
  emptyActionLabel,
  onEmptyAction,
  children,
}: {
  title: string;
  subtitle?: string;
  empty: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  children: React.ReactNode;
}) {
  const hasContent = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text variant="caption" color="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {hasContent ? (
        <View style={{ gap: spacing.md }}>{children}</View>
      ) : (
        <EmptyState
          illustration="box"
          title={title}
          description={empty}
          {...(emptyActionLabel && onEmptyAction
            ? { action: { label: emptyActionLabel, onPress: onEmptyAction } }
            : {})}
        />
      )}
    </View>
  );
}

/** Псевдо-карточка офлайн-созданного долга (до подтверждения сервером). */
function PendingDebtCard({
  pending,
}: {
  pending: { debtorName?: string; amount: number; description?: string; createdAt: string };
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderRadius: 20,
        borderColor: 'rgba(120,120,120,0.5)',
        padding: spacing.lg,
        gap: spacing.xs,
      }}
    >
      <Text variant="caption" color="secondary">
        Отправится при подключении · {pending.debtorName ?? 'контрагент'}
      </Text>
      <Text variant="title">{formatMoney(String(pending.amount))}</Text>
      {pending.description ? (
        <Text variant="body" color="secondary">
          {pending.description}
        </Text>
      ) : null}
    </View>
  );
}

/** Сводка секции: «12 500 ₽ · 2 активных». */
function summarize(debts: { amount: string; status: DebtStatus }[]): string | undefined {
  const active = debts.filter((d) => d.status === 'active');
  if (debts.length === 0) {
    return undefined;
  }
  const total = active.reduce((sum, d) => sum + Number.parseFloat(d.amount), 0);
  return active.length > 0
    ? `${formatMoney(total.toFixed(2))} активных: ${active.length}`
    : `Всего записей: ${debts.length}`;
}
