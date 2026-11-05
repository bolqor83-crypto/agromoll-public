import { View } from 'react-native';
import type { ReactNode } from 'react';
import { Badge, Card, Icon, spacing, Text, useTheme } from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { LISTING_CATEGORY_LABELS } from '@agromoll/types';
import { formatAvailable, formatPrice } from '@/lib/format';

/** Иконка-заглушка по категории товара (фото появятся на следующем этапе). */
const CATEGORY_ICONS: Record<
  string,
  'leaf-outline' | 'nutrition-outline' | 'cube-outline' | 'fast-food-outline' | 'pricetag-outline'
> = {
  vegetables: 'leaf-outline',
  fruits: 'nutrition-outline',
  grocery: 'cube-outline',
  snacks: 'fast-food-outline',
  other: 'pricetag-outline',
};

export interface ListingCardProps {
  listing: ListingDto;
  /** Нажатие на карточку — переход к детальному экрану. */
  onPress?: () => void;
  /** Режим витрины продавца: показывать остатки и статус. */
  sellerView?: boolean;
  /** Дополнительный контент под карточкой (кнопки бронирования). */
  footer?: ReactNode;
}

/** Карточка товара в ленте и витрине: фото → название → цена → бейджи. */
export function ListingCard({ listing, onPress, sellerView = false, footer }: ListingCardProps) {
  const { colors } = useTheme();

  const badges: ReactNode[] = [];
  if (listing.isPerishable) {
    badges.push(<Badge key="perishable" label="Скоропорт" variant="attention" />);
  } else if (listing.category === 'vegetables' || listing.category === 'fruits') {
    badges.push(<Badge key="fresh" label="Свежий" variant="success" />);
  }
  if (listing.lineNumber !== null) {
    badges.push(<Badge key="line" label={`Линия ${listing.lineNumber}`} variant="neutral" />);
  }
  if (sellerView && listing.status !== 'active') {
    badges.push(
      <Badge
        key="status"
        label={
          listing.status === 'paused'
            ? 'На паузе'
            : listing.status === 'sold_out'
              ? 'Продано'
              : 'В архиве'
        }
        variant="neutral"
      />,
    );
  }

  return (
    <Card onPress={onPress} style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: colors.primaryMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={CATEGORY_ICONS[listing.category] ?? 'pricetag-outline'}
            size={26}
            color="primary"
          />
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="title">{listing.title}</Text>
          <Text variant="caption" color="secondary">
            {sellerView
              ? LISTING_CATEGORY_LABELS[listing.category]
              : `${listing.sellerName ?? 'Продавец'}${listing.lineNumber !== null ? ` · линия ${listing.lineNumber}` : ''}`}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              marginTop: spacing.xs,
            }}
          >
            <Text variant="body" weight="700" color="primary">
              {formatPrice(listing.pricePerUnit, listing.unit)}
            </Text>
          </View>
          <Text variant="caption" color={sellerView ? 'secondary' : 'muted'}>
            {formatAvailable(listing.quantityAvailableForBooking, listing.unit)}
            {sellerView ? ` · зарезервировано ${listing.quantityReserved}` : ''}
          </Text>
        </View>
      </View>
      {badges.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{badges}</View>
      ) : null}
      {footer}
    </Card>
  );
}
