import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { typography, useTheme } from '@agromoll/ui';

/** Три роли рынка — три вкладки. Переключение в одно касание, крупная подпись. */
const ICONS: Record<
  string,
  { focused: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }
> = {
  index: { focused: 'basket', idle: 'basket-outline' },
  seller: { focused: 'storefront', idle: 'storefront-outline' },
  driver: { focused: 'car', idle: 'car-outline' },
};

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: typography.caption.fontSize, fontWeight: '600' },
        tabBarIcon: ({ color, focused }) => {
          const icon = ICONS[route.name] ?? ICONS.index;
          return <Ionicons name={focused ? icon.focused : icon.idle} size={24} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Покупатель' }} />
      <Tabs.Screen name="seller" options={{ title: 'Продавец' }} />
      <Tabs.Screen name="driver" options={{ title: 'Доставщик' }} />
    </Tabs>
  );
}
