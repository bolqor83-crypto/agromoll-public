import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import type { ReactNode } from 'react';
import { Badge, Card, Icon, spacing, tap, Text, useTheme } from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { LISTING_CATEGORY_LABELS } from '@agromoll/types';
import { RatingBadge } from './RatingBadge';
import { formatAvailable, formatPrice } from '@/lib/format';
import { recordTransitionOrigin } from '@/lib/transition';

/** Иконка-заглушка по категории товара (фото нет или не загрузилось). */
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
  // Опорный элемент морфа: квадрат «фото» (v0.3.1, ADR-009).
  const anchorRef = useRef<View>(null);
  // Обложка не загрузилась (сеть/протухший presigned) — показываем
  // иконку категории: деградация, а не пустой квадрат (v0.7.0-D).
  const [coverBroken, setCoverBroken] = useState(false);
  const cover = listing.coverUrl && !coverBroken ? listing.coverUrl : null;

  const badges: ReactNode[] = [];
  // Рейтинг продавца — первым: доверие важнее «скоропорта» (ADR-013).
  if (!sellerView) {
    badges.push(<RatingBadge key="rating" rating={listing.sellerRating ?? null} />);
  }
  if (listing.isPerishable) {
    badges.push(
      <Badge key="perishable" label="Скоропорт" variant="attention" icon="time-outline" />,
    );
  } else if (listing.category === 'vegetables' || listing.category === 'fruits') {
    badges.push(<Badge key="fresh" label="Свежий" variant="success" icon="leaf-outline" />);
  }
  if (listing.lineNumber !== null) {
    badges.push(
      <Badge
        key="line"
        label={`Линия ${listing.lineNumber}`}
        variant="neutral"
        icon="locate-outline"
      />,
    );
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

  const handlePress = (): void => {
    if (!onPress) {
      return;
    }
    tap();
    // Замерим «фото» — детальный экран вырастет из этого фрейма.
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        recordTransitionOrigin(listing.id, { x, y, width, height });
      }
      onPress();
    });
  };

  return (
    <Card onPress={handlePress} style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View
          ref={anchorRef}
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: colors.primaryMuted,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {cover ? (
            <Image
              source={{ uri: cover }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              onError={() => setCoverBroken(true)}
              accessibilityLabel={`Фото: ${listing.title}`}
            />
          ) : (
            <Icon
              name={CATEGORY_ICONS[listing.category] ?? 'pricetag-outline'}
              size={26}
              color="primary"
            />
          )}
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
            {/* v0.6.2-B: цена — табличные цифры (не прыгает при обновлении),
                weight 700 — визуальный якорь карточки (аудит №9) */}
            <Text variant="body" weight="700" color="primary" numeric>
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
