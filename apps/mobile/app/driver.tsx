import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@agromoll/ui';

import { ItemCard } from '../src/components/ItemCard';
import { ThemeToggleButton } from '../src/components/ThemeToggleButton';
import { DRIVER_ROUTES, STUB_NOTE } from '../src/data/placeholders';
import { hapticImpact } from '../src/lib/haptics';
import { logger } from '../src/lib/logger';

/** Доставщик — попутчик. Заглушка: доступные попутные маршруты. */
export default function DriverScreen() {
  const router = useRouter();

  const handleStubPress = (action: string) => {
    void hapticImpact('medium');
    logger.info('Заглушка нажата', { screen: 'driver', action });
  };

  return (
    <Screen onBack={() => router.back()} headerRight={<ThemeToggleButton />}>
      <Text variant="display">Доставщик</Text>
      <Text variant="body" color="secondary" style={styles.subtitle}>
        Попутные доставки по маршруту.
      </Text>

      <Text variant="caption" color="muted" style={styles.section}>
        Рядом с рынком
      </Text>
      <View style={styles.list}>
        {DRIVER_ROUTES.map((item) => (
          <ItemCard key={item.title} item={item} onPress={() => handleStubPress(`маршрут: ${item.title}`)} />
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Взять доставку" onPress={() => handleStubPress('take-route')} />
        <Button
          label="Мои маршруты"
          variant="secondary"
          onPress={() => handleStubPress('my-routes')}
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
