import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Input, Screen, Text } from '@agromoll/ui';

import { ItemCard } from '../src/components/ItemCard';
import { ThemeToggleButton } from '../src/components/ThemeToggleButton';
import { BUYER_FREQUENT, STUB_NOTE } from '../src/data/placeholders';
import { hapticImpact } from '../src/lib/haptics';
import { logger } from '../src/lib/logger';

/** Покупатель — владелец ларька. Заглушка: поиск + «часто закупают». */
export default function BuyerScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleStubPress = (action: string) => {
    void hapticImpact('medium');
    logger.info('Заглушка нажата', { screen: 'buyer', action, query });
  };

  return (
    <Screen onBack={() => router.back()} headerRight={<ThemeToggleButton />}>
      <Text variant="display">Покупатель</Text>
      <Text variant="body" color="secondary" style={styles.subtitle}>
        Доброе утро! Что нужно закупить сегодня?
      </Text>

      <Input
        label="Что нужно найти?"
        placeholder="Морковь, лук, картофель…"
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        autoCorrect={false}
      />

      <Text variant="caption" color="muted" style={styles.section}>
        Часто закупают
      </Text>
      <View style={styles.list}>
        {BUYER_FREQUENT.map((item) => (
          <ItemCard key={item.title} item={item} onPress={() => handleStubPress(`товар: ${item.title}`)} />
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Сделать заявку" onPress={() => handleStubPress('make-request')} />
        <Button
          label="История заявок"
          variant="secondary"
          onPress={() => handleStubPress('history')}
        />
      </View>

      <Text variant="caption" color="muted" style={styles.note}>
        {STUB_NOTE}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginBottom: 24 },
  section: { textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 24, marginBottom: 4 },
  list: { gap: 12 },
  actions: { gap: 12, marginTop: 24 },
  note: { textAlign: 'center', marginTop: 24 },
});
