/**
 * Экран входа (v0.3.0): телефон + SMS-код (см. ADR-007).
 *
 * Шаг 1: телефон с маской +7 (___) ___-__-__, крупная кнопка «Получить код».
 * Шаг 2: 6 ячеек кода с авто-переходом, таймер повторной отправки 60 сек.
 * В dev-режиме (__DEV__) — подсказка «Код: 0000» внизу: код-заглушка.
 * Тёмная тема поддерживается токенами дизайн-системы автоматически.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import {
  Button,
  Icon,
  Input,
  Screen,
  SkeletonCard,
  spacing,
  Text,
  radius,
  useTheme,
} from '@agromoll/ui';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { api, toApiError } from '@/lib/api';
import { normalizePhone } from '@agromoll/types';

/** Перевод «сырых» цифр в маску +7 (961) 123-45-67. */
function formatPhoneMask(digits: string): string {
  const d = digits.slice(0, 10); // без кода страны: 9611234567
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 8);
  const p4 = d.slice(8, 10);
  let masked = '+7';
  if (p1.length > 0) masked += ` (${p1}`;
  if (p1.length === 3) masked += ')';
  if (p2.length > 0) masked += ` ${p2}`;
  if (p3.length > 0) masked += `-${p3}`;
  if (p4.length > 0) masked += `-${p4}`;
  return masked;
}

/** Из маски/сырой строки — цифры без кода страны (10). */
function phoneDigitsFromInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  // убираем ведущие 7/8 (код страны), если ввели целиком
  const withoutCountry =
    digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))
      ? digits.slice(1)
      : digits;
  return withoutCountry.slice(0, 10);
}

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function AuthScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  // v0.3.1: мягкое сообщение, если сессию завершил сервер (ротация
  // обнаружила повторное использование refresh-токена).
  const signOutNotice = useAuthStore((s) => s.signOutNotice);

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('+7 (');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendLeft, setResendLeft] = useState(0);

  const hiddenCodeInput = useRef<TextInput>(null);
  const normalizedPhone = useMemo(() => normalizePhone(phoneInput), [phoneInput]);
  const codeReady = code.length === CODE_LENGTH;

  // Таймер повторной отправки: тикает каждую секунду, пока > 0.
  useEffect(() => {
    if (resendLeft <= 0) {
      return;
    }
    const timer = setInterval(() => setResendLeft((left) => left - 1), 1000);
    return () => clearInterval(timer);
  }, [resendLeft]);

  const requestCode = async (): Promise<void> => {
    if (!normalizedPhone) {
      setError('Введите российский номер: +7 XXX XXX-XX-XX');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.requestCode(normalizedPhone);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setStep('code');
      setCode('');
      setResendLeft(RESEND_SECONDS);
      // авто-фокус на ввод кода после перехода
      setTimeout(() => hiddenCodeInput.current?.focus(), 150);
    } catch (err) {
      const apiError = toApiError(err);
      setError(
        apiError.code === 'RATE_LIMITED'
          ? 'Код уже запрошен. Подождите минуту — и попробуйте снова.'
          : (apiError.hint ?? 'Не удалось отправить код. Проверьте связь и попробуйте ещё раз.'),
      );
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (finalCode?: string): Promise<void> => {
    const value = finalCode ?? code;
    if (value.length !== CODE_LENGTH) {
      setError(`Введите ${CODE_LENGTH} цифр кода из SMS`);
      return;
    }
    if (!normalizedPhone) {
      setStep('phone');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const auth = await api.verify(normalizedPhone, value);
      await signIn(auth);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.replace('/');
    } catch (err) {
      const apiError = toApiError(err);
      setError(apiError.hint ?? 'Неверный код. Проверьте и попробуйте ещё раз.');
      setCode('');
      hiddenCodeInput.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  /** Единое скрытое поле: digits-only, максимум 6. */
  const handleCodeText = (text: string): void => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length > code.length) {
      void Haptics.selectionAsync().catch(() => undefined);
    }
    if (digits.length === CODE_LENGTH) {
      hiddenCodeInput.current?.blur();
      void verifyCode(digits);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.lg,
            backgroundColor: colors.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.sm,
          }}
        >
          <Icon name="leaf-outline" size={32} color="primary" />
        </View>
        <Text variant="display">Вход в АгроМолл</Text>
        <Text variant="body" color="secondary">
          {step === 'phone'
            ? 'Введите телефон — пришлём код подтверждения. Номер нужен, чтобы продавец и покупатель были на связи на рынке.'
            : `Код отправлен на ${formatPhoneMask(phoneDigitsFromInput(phoneInput))}. Введите 6 цифр из SMS.`}
        </Text>
      </View>

      {signOutNotice ? (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            marginBottom: spacing.lg,
            padding: spacing.md,
            borderRadius: radius.md,
            // Мягкий янтарный тон (не красный): ничего страшного не
            // случилось — просто войдите снова.
            backgroundColor: colors.warning + '1F',
          }}
        >
          <Icon name="time-outline" size={20} color="warning" />
          <Text variant="body" color="secondary" style={{ flex: 1 }}>
            {signOutNotice}
          </Text>
        </View>
      ) : null}

      {step === 'phone' ? (
        <View style={{ gap: spacing.lg }}>
          <Input
            label="Телефон"
            value={phoneInput}
            onChangeText={(value) => {
              setPhoneInput(formatPhoneMask(phoneDigitsFromInput(value)));
              setError(null);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            inputMode="tel"
            autoFocus
            maxLength={18}
            placeholder="+7 (961) 123-45-67"
            error={error}
          />
          <Button
            title="Получить код"
            onPress={() => void requestCode()}
            loading={loading}
            disabled={!normalizedPhone}
          />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <View>
            <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
              Код из SMS
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Поле ввода кода из SMS"
              onPress={() => hiddenCodeInput.current?.focus()}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.xs,
              }}
            >
              {Array.from({ length: CODE_LENGTH }, (_, index) => {
                const filled = index < code.length;
                const isCurrent = index === code.length;
                return (
                  <View
                    key={index}
                    style={{
                      flex: 1,
                      minHeight: 64,
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderColor: error
                        ? colors.warning
                        : isCurrent
                          ? colors.primary
                          : colors.border,
                      backgroundColor: filled ? colors.surfaceElevated : colors.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {filled ? (
                      <Text variant="title" weight="700">
                        {code[index]}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              {/* Единое скрытое поле: держит клавиатуру, ввод и backspace */}
              <TextInput
                ref={hiddenCodeInput}
                value={code}
                onChangeText={handleCodeText}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                accessibilityLabel="Код из SMS"
                style={{ position: 'absolute', opacity: 0, height: 1, width: '100%' }}
              />
            </Pressable>
          </View>

          {error ? (
            <Text variant="caption" color="onWarning" weight="600">
              {error}
            </Text>
          ) : null}

          <Button
            title="Войти"
            onPress={() => void verifyCode()}
            loading={loading}
            disabled={!codeReady}
          />

          <Pressable
            onPress={() => {
              if (resendLeft === 0) {
                setStep('phone');
                setError(null);
              }
            }}
            disabled={resendLeft > 0}
            accessibilityRole="button"
            accessibilityLabel="Изменить телефон или запросить код повторно"
          >
            <Text variant="caption" color={resendLeft > 0 ? 'muted' : 'secondary'} align="center">
              {resendLeft > 0
                ? `Запросить код повторно можно через ${resendLeft} с`
                : 'Не пришло SMS? Запросить код повторно'}
            </Text>
          </Pressable>
        </View>
      )}

      {__DEV__ && step === 'code' ? (
        <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.lg }}>
          Dev-режим: код-заглушка 0000
        </Text>
      ) : null}

      {loading && step === 'code' ? (
        <View style={{ marginTop: spacing.md }}>
          <SkeletonCard />
        </View>
      ) : null}

      <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.xl }}>
        Входя, вы соглашаетесь с правилами рынка «АгроМолл».
      </Text>
    </Screen>
  );
}
