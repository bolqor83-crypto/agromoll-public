/**
 * WorkHoursScreen — экран учёта часов 289-ФЗ (v0.4.0, ADR-011).
 *
 * Только часы — никаких денег (юридическая страховка платформы,
 * а не биллинг). Два вида:
 *  - driver («Мои часы»): пары с продавцами, прогресс до 60 ч,
 *    серия месяцев, мягкое предупреждение «близки к лимиту»
 *    (>50 ч и серия 5), старт/завершение смены;
 *  - seller («Часы с водителями»): только просмотр.
 *
 * Блокировка пары — мягкий тон: «по закону нужна пауза, чтобы защитить
 * вас и платформу» (не «вы нарушили закон», спецификация v0.4.0-B).
 * Сессии — прямые вызовы API: серверные временные метки авторитетны.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AnimatedNumber,
  Badge,
  Button,
  Card,
  EmptyState,
  PullToRefreshScrollView,
  ProgressBar,
  Screen,
  SkeletonCard,
  Text,
  spacing,
} from '@agromoll/ui';
import type { CounterpartyDto, WorkHoursPairDto, WorkHoursSessionDto } from '@agromoll/types';
import { APPEAL_STATUS_LABELS, WORK_HOURS_UI } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AppealSheet } from '@/components/AppealSheet';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/auth';

/** Лимит для прогресс-бара: 60 ч (значение ENV по умолчанию, ADR-011). */
const MONTHLY_LIMIT_MINUTES = 60 * 60;

type HoursState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'ready'; pairs: WorkHoursPairDto[]; openSession: WorkHoursSessionDto | null };

export function WorkHoursScreen() {
  const role = useAuthStore((s) => s.user?.role ?? 'buyer');
  const isDriver = role === 'driver';
  const [state, setState] = useState<HoursState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [counterparties, setCounterparties] = useState<CounterpartyDto[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  // v0.6.0-E (ADR-035): шторка обжалования блокировки.
  const [appealPair, setAppealPair] = useState<WorkHoursPairDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [pairs, openSession] = await Promise.all([
        api.workHoursMine(),
        isDriver ? api.workHoursOpenSession() : Promise.resolve(null),
      ]);
      setState({ phase: 'ready', pairs, openSession });
    } catch (error) {
      if (isInvalidResponseError(error)) {
        setState({ phase: 'invalid' });
        return;
      }
      logger.warn('work-hours', 'API недоступен', { error: String(error) });
      setState({ phase: 'ready', pairs: [], openSession: null });
    }
  }, [isDriver]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /** Начать смену: прямой вызов; 409 WORK_PAIR_BLOCKED — мягкий экран паузы
   *  с подсказкой об апелляции (ADR-035). */
  const handleStart = useCallback(
    (sellerId: string): void => {
      setBusy(true);
      void api
        .startWorkSession(sellerId)
        .then(() => setPickerVisible(false))
        .then(() => load())
        .catch((error: unknown) => {
          const apiError = toApiError(error);
          const body = apiError.body as { code?: string } | undefined;
          if (body?.code === 'WORK_PAIR_BLOCKED') {
            Alert.alert(
              'Нужна пауза',
              (apiError.hint ?? '') +
                '\n\nПо закону нужна пауза, чтобы защитить вас и платформу. ' +
                'Попробуйте другого продавца или подождите — счётчик обнулится в следующем месяце. ' +
                'Если часы считались неверно — оспорьте блокировку в карточке пары ниже.',
            );
          } else {
            Alert.alert('Смена', apiError.hint ?? apiError.message);
          }
        })
        .finally(() => setBusy(false));
    },
    [load],
  );

  const handleEnd = useCallback(
    (sessionId: string): void => {
      setBusy(true);
      void api
        .endWorkSession(sessionId)
        .then(() => load())
        .catch((error: unknown) => {
          Alert.alert('Смена', toApiError(error).hint ?? 'Не удалось завершить смену');
        })
        .finally(() => setBusy(false));
    },
    [load],
  );

  const loadCounterparties = useCallback(async (): Promise<void> => {
    try {
      setCounterparties(await api.debtCounterparties());
    } catch {
      setCounterparties([]);
    }
  }, []);

  const openPicker = useCallback((): void => {
    void loadCounterparties();
    setPickerVisible(true);
  }, [loadCounterparties]);

  const title = isDriver ? 'Мои часы' : 'Часы с водителями';
  const subtitle = isDriver
    ? '289-ФЗ: до 60 часов в месяц с одним продавцом'
    : 'Сколько часов работали с вами водители в этом месяце';

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        badge={<Badge label="Только часы · это не оплата" variant="neutral" />}
      />

      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md, padding: spacing.lg }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.phase === 'invalid' ? (
        <EmptyState
          illustration="radar"
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
            gap: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          {isDriver && state.openSession ? (
            <Card style={{ borderColor: undefined }}>
              <View style={{ gap: spacing.sm }}>
                <Text variant="body" weight="600">
                  Смена идёт: {state.openSession.sellerName}
                </Text>
                <Text variant="caption" color="secondary">
                  Начали в{' '}
                  {new Date(state.openSession.startedAt).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · часы учитываются автоматически
                </Text>
                <Button
                  title="Завершить смену"
                  variant="primary"
                  size="md"
                  disabled={busy}
                  onPress={() => handleEnd(state.openSession!.id)}
                />
              </View>
            </Card>
          ) : null}

          {state.pairs.length === 0 && !state.openSession ? (
            <EmptyState
              illustration="radar"
              title={isDriver ? 'Смен пока нет' : 'Часов пока нет'}
              description={
                isDriver
                  ? 'Начните смену с продавцом — платформа посчитает часы пары за месяц. Лимит 60 часов в месяц защищает и вас, и продавца.'
                  : 'Когда водители начнут брать у вас товар, часы пары появятся здесь.'
              }
              action={
                isDriver
                  ? { label: 'Начать смену', onPress: openPicker }
                  : { label: 'Обновить', onPress: handleRefresh }
              }
            />
          ) : (
            state.pairs.map((pair) => (
              <PairCard
                key={pair.counterpartId}
                pair={pair}
                isDriver={isDriver}
                busy={busy}
                onEnd={handleEnd}
                onAppeal={setAppealPair}
              />
            ))
          )}

          {isDriver && !state.openSession && state.pairs.length > 0 ? (
            <Button
              title="Начать смену"
              variant="secondary"
              size="lg"
              disabled={busy}
              onPress={openPicker}
            />
          ) : null}
        </PullToRefreshScrollView>
      )}

      {pickerVisible ? (
        <SellerPicker
          counterparties={counterparties}
          busy={busy}
          onPick={handleStart}
          onClose={() => setPickerVisible(false)}
        />
      ) : null}

      {/* v0.6.0-E (ADR-035): обжалование блокировки пары в арбитраж. */}
      {appealPair?.blockedPairId ? (
        <AppealSheet
          visible
          blockedPairId={appealPair.blockedPairId}
          counterpartName={appealPair.counterpartName}
          onClose={() => setAppealPair(null)}
          onOpened={() => void load()}
        />
      ) : null}
    </Screen>
  );
}

/** Карточка пары: имя, часы месяца, прогресс-бар, серия, предупреждения,
 *  кнопка обжалования блокировки (v0.6.0-E, ADR-035). */
function PairCard({
  pair,
  isDriver,
  busy,
  onEnd,
  onAppeal,
}: {
  pair: WorkHoursPairDto;
  isDriver: boolean;
  busy: boolean;
  onEnd: (sessionId: string) => void;
  /** Открыть шторку обжалования (заблокированная пара без активной апелляции). */
  onAppeal: (pair: WorkHoursPairDto) => void;
}) {
  const router = useRouter();
  const approaching =
    pair.totalMinutes >= WORK_HOURS_UI.approachingMinutes &&
    pair.series >= WORK_HOURS_UI.approachingSeries;

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: spacing.sm,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="body" weight="600" numberOfLines={1}>
              {pair.counterpartName}
            </Text>
            <Text variant="caption" color="secondary">
              Серия месяцев: {pair.series}
              {pair.monthCounted ? ' · месяц засчитан' : ''}
            </Text>
          </View>
          {pair.blocked ? (
            pair.appeal ? (
              // v0.7.0-C (ADR-037): бейдж ведёт к переписке с арбитром —
              // у пары больше нет «немого ожидания» решения.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Апелляция: ${APPEAL_STATUS_LABELS[pair.appeal.status]}, открыть переписку`}
                onPress={() => router.push(`/appeal/${pair.appeal!.id}`)}
              >
                <Badge
                  label={`Апелляция: ${APPEAL_STATUS_LABELS[pair.appeal.status]} · переписка`}
                  variant="neutral"
                />
              </Pressable>
            ) : (
              <Badge label="Пауза по 289-ФЗ" variant="attention" />
            )
          ) : pair.monthCounted ? (
            <Badge label="60 ч достигнуты" variant="attention" />
          ) : approaching ? (
            <Badge label="Близки к лимиту" variant="attention" />
          ) : null}
        </View>

        <ProgressBar progress={pair.totalMinutes / MONTHLY_LIMIT_MINUTES}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {/* v0.6.1-E2 (ADR-027): часы «пробегают» к новому значению —
                видно, сколько добавилось за смену, а не только итог. */}
            <Text variant="caption" color="secondary">
              <AnimatedNumber
                value={pair.totalMinutes}
                format={formatHours}
                variant="caption"
                color="secondary"
              />{' '}
              из 60 ч в этом месяце
            </Text>
          </View>
        </ProgressBar>

        {pair.blocked ? (
          pair.appeal ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Открыть апелляцию и переписку с арбитром"
              onPress={() => router.push(`/appeal/${pair.appeal!.id}`)}
            >
              <Text variant="caption" color="primary">
                По закону нужна пауза, чтобы защитить вас и платформу. Апелляция в арбитраже —
                откройте кейс, чтобы ответить арбитру и увидеть решение.
              </Text>
            </Pressable>
          ) : (
            <>
              <Text variant="caption" color="secondary">
                По закону нужна пауза, чтобы защитить вас и платформу. Счётчик обнулится в следующем
                месяце — или оспорьте блокировку, если часы считались неверно.
              </Text>
              {/* Обжаловать может любая сторона пары — и водитель, и продавец. */}
              <Button
                title="Оспорить блокировку"
                variant="secondary"
                size="md"
                disabled={busy}
                onPress={() => onAppeal(pair)}
              />
            </>
          )
        ) : approaching ? (
          <Text variant="caption" color="secondary">
            Вы близки к лимиту по 289-ФЗ с {pair.counterpartName}. Скоро потребуется пауза.
          </Text>
        ) : null}

        {isDriver && pair.activeSessionId ? (
          <Button
            title="Завершить смену"
            variant="primary"
            size="md"
            disabled={busy}
            onPress={() => onEnd(pair.activeSessionId!)}
          />
        ) : null}
      </View>
    </Card>
  );
}

/** Выбор продавца для начала смены (с кем уже были сделки). */
function SellerPicker({
  counterparties,
  busy,
  onPick,
  onClose,
}: {
  counterparties: CounterpartyDto[];
  busy: boolean;
  onPick: (sellerId: string) => void;
  onClose: () => void;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        top: 0,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'flex-end',
      }}
    >
      <View
        style={{
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <Card elevated>
          <View style={{ gap: spacing.md }}>
            <Text variant="title">Начать смену с продавцом</Text>
            <Text variant="caption" color="secondary">
              Смена начнётся сейчас — часы посчитаются автоматически при завершении. Часы пары видны
              и продавцу.
            </Text>
            {counterparties.length === 0 ? (
              <Text variant="body" color="secondary">
                Пока нет контрагентов: список соберётся после первых сделок.
              </Text>
            ) : (
              counterparties.map((candidate) => (
                <Button
                  key={candidate.id}
                  title={candidate.displayName}
                  variant="secondary"
                  size="md"
                  disabled={busy}
                  onPress={() => onPick(candidate.id)}
                />
              ))
            )}
            <Button title="Отмена" variant="ghost" size="md" disabled={busy} onPress={onClose} />
          </View>
        </Card>
      </View>
    </View>
  );
}

/** «48 ч 20 мин» — часы из минут. */
function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}
