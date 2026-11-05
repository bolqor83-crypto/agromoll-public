/**
 * DebtSummaryWidget — виджет долгов на домашнем экране роли (v0.4.0, ADR-010).
 *
 * «Вам должны: 12 500 ₽ · 3 записи» / «Вы должны: 4 200 ₽ · 2 записи».
 * Просрочка (>30 дней active) — янтарный акцент. Тап — переход на «Долги».
 *
 * Скромность важнее информации: долгов нет или API недоступен —
 * виджет не занимает место (null), домашний экран остаётся чистым.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Badge, Card, Icon, Text, spacing, useTheme } from '@agromoll/ui';
import type { DebtsSummaryDto } from '@agromoll/types';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

type WidgetState =
  | { phase: 'loading' }
  | { phase: 'hidden' }
  | { phase: 'ready'; summary: DebtsSummaryDto };

export function DebtSummaryWidget() {
  const router = useRouter();
  const { colors } = useTheme();
  const [state, setState] = useState<WidgetState>({ phase: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    try {
      const summary = await api.debtsSummary();
      if (summary.owedToMe.count === 0 && summary.iOwe.count === 0) {
        setState({ phase: 'hidden' });
        return;
      }
      setState({ phase: 'ready', summary });
    } catch {
      // Долги — вспомогательный экран: без API виджет просто не показываем.
      setState({ phase: 'hidden' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase !== 'ready') {
    return null;
  }

  const { owedToMe, iOwe } = state.summary;
  const hasOverdue = owedToMe.overdueCount > 0 || iOwe.overdueCount > 0;

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Открыть долги"
        onPress={() => router.push('/debts')}
      >
        <Card
          padding={spacing.md}
          style={{
            borderColor: hasOverdue ? colors.warning : colors.border,
          }}
        >
          <View style={{ gap: spacing.xs }}>
            {owedToMe.count > 0 ? (
              <Row
                icon="trending-up-outline"
                label="Вам должны"
                value={`${formatMoney(owedToMe.total)} · ${owedToMe.count} запис${plural(owedToMe.count)}`}
                overdue={owedToMe.overdueCount > 0}
              />
            ) : null}
            {iOwe.count > 0 ? (
              <Row
                icon="trending-down-outline"
                label="Вы должны"
                value={`${formatMoney(iOwe.total)} · ${iOwe.count} запис${plural(iOwe.count)}`}
                overdue={iOwe.overdueCount > 0}
              />
            ) : null}
            {hasOverdue ? (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Badge label="Есть просрочка · 30+ дней" variant="attention" />
              </View>
            ) : null}
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
}

function Row({
  icon,
  label,
  value,
  overdue,
}: {
  icon: 'trending-up-outline' | 'trending-down-outline';
  label: string;
  value: string;
  overdue: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Icon name={icon} size={20} color={overdue ? 'warning' : 'primary'} />
      <Text variant="caption" color="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="body" weight="600" color={overdue ? 'warning' : 'text'}>
        {value}
      </Text>
    </View>
  );
}

/** «ь» / «и» / «ей» — согласование числа записей. */
function plural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ь';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'и';
  return 'ей';
}
