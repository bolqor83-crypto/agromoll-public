import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@agromoll/ui';

import { ItemCard } from '../src/components/ItemCard';
import { ThemeToggleButton } from '../src/components/ThemeToggleButton';
import { SELLER_ORDERS, SELLER_PRICES, STUB_NOTE } from '../src/data/placeholders';
import { hapticImpact } from '../src/lib/haptics';
import { logger } from '../src/lib/logger';

/** Продавец — оптовик. Заглушка: прайс на сегодня + заказы на утро. */
export default function SellerScreen() {
  const router = useRouter();

  const handleStubPress = (action: string) => {
    void hapticImpact('medium');
    logger.info('Заглушка нажата', { screen: 'seller', action });
  };

  return (
    <Screen onBack={() => router.back()} headerRight={<ThemeToggleButton />}>
      <Text variant="display">Продавец</Text>
      <Text variant="body" color="secondary" style={styles.subtitle}>
        Смена на рынке — с 4:00 до 14:00.
      </Text>

      <Text variant="caption" color="muted" style={styles.section}>
        Прайс на сегодня
      </Text>
      <View style={styles.list}>
        {SELLER_PRICES.map((item) => (
          <ItemCard key={item.title} item={item} onPress={() => handleStubPress(`прайс: ${item.title}`)} />
        ))}
      </View>

      <Text variant="caption" color="muted" style={styles.section}>
        Заказы на утро
      </Text>
      <View style={styles.list}>
        {SELLER_ORDERS.map((item) => (
          <ItemCard key={item.title} item={item} onPress={() => handleStubPress(`заказ: ${item.title}`)} />
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Открыть смену" onPress={() => handleStubPress('open-shift')} />
        <Button
          label="Изменить прайс"
          variant="secondary"
          onPress={() => handleStubPress('edit-prices')}
        />
      </View>

      <Text variant="caption" color="muted" style={styles.note}>
        {STUB_NOTE}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginBottom: 8 },
  section: { textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 24, marginBottom: 4 },
  list: { gap: 12 },
  actions: { gap: 12, marginTop: 24 },
  note: { textAlign: 'center', marginTop: 24 },
});
