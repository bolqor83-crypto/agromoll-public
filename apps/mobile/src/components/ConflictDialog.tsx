/**
 * Диалог разрешения конфликта outbox (v0.3.0, ADR-006).
 *
 * Сервер отверг операцию по бизнес-правилу (например, бронь уже
 * отменена). Молча решать нельзя — человек выбирает:
 *  «Принять серверное» — удалить локальную операцию и перечитать данные;
 *  «Отменить локальную» — удалить операцию, оставив текущий вид.
 * Диалог модальный, янтарный (предупреждение), без красного.
 */
import { Modal, Pressable, View } from 'react-native';
import { Button, Icon, radius, spacing, Text, useTheme } from '@agromoll/ui';
import { useOutboxStore } from '@/store/outbox';

/** Человекочитаемое описание типа операции. */
const OPERATION_LABELS: Record<string, string> = {
  create_booking: 'создание брони',
  cancel_booking: 'отмена брони',
  confirm_booking: 'подтверждение брони',
  counter_offer_booking: 'корректировка брони',
  accept_counter_booking: 'принятие корректировки',
  create_debt: 'запись долга',
  confirm_delivery: 'подтверждение доставки',
};

export function ConflictDialog() {
  const { colors } = useTheme();
  const conflicted = useOutboxStore((s) => s.conflictedOperation);
  const resolveConflict = useOutboxStore((s) => s.resolveConflict);

  if (!conflicted) {
    return null;
  }

  const operationLabel = OPERATION_LABELS[conflicted.operationType] ?? conflicted.operationType;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(15, 23, 20, 0.55)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.lg,
        }}
      >
        <View
          accessibilityLabel="Конфликт с сервером"
          style={{
            width: '100%',
            maxWidth: 420,
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: colors.warning,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="alert-circle-outline" size={26} color="warning" />
            <Text variant="title" weight="700">
              Изменилось на сервере
            </Text>
          </View>
          <Text variant="body" color="secondary">
            Не удалось выполнить {operationLabel}: {conflicted.message.toLowerCase()}. Что делаем?
          </Text>
          <Button
            title="Принять серверное"
            variant="primary"
            size="md"
            onPress={() => void resolveConflict('accept-server')}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отменить локальную операцию"
            onPress={() => void resolveConflict('discard-local')}
            style={{
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text variant="body" weight="600" color="secondary">
              Отменить локальную
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
