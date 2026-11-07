/**
 * Фото товара (v0.7.0-D, ADR-038): карусель в деталях лота + полноэкранная галерея.
 *
 * Карусель: горизонтальный FlatList с пейджингом по ширине контейнера
 * (onLayout — контейнер ужмётся на планшете/десктопе), точки-индикаторы.
 * Тап по фото открывает галерею (Modal): свайп между фото, счётчик, крестик.
 *
 * Без фото экран не рендерит этот компонент вовсе (иконка-заглушка
 * осталась в ListingDetailScreen для лотов без фото и демо-данных).
 */
import { useCallback, useState } from 'react';
import { FlatList, Image, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import type { ListRenderItemInfo, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon, spacing, tap, useTheme } from '@agromoll/ui';
import type { ListingPhotoDto } from '@agromoll/types';

export interface ListingPhotosProps {
  photos: ListingPhotoDto[];
  /** Заголовок для accessibility. */
  title: string;
}

/** Точка-индикатор: активная шире (капсула), неактивная — маленький круг. */
function Dot({ active }: { active: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: active ? 18 : 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: active ? colors.primary : colors.border,
      }}
    />
  );
}

export function ListingPhotos({ photos, title }: ListingPhotosProps) {
  const { width: windowWidth } = useWindowDimensions();
  const { colors } = useTheme();
  const [containerWidth, setContainerWidth] = useState(windowWidth - 48);
  const [activeIndex, setActiveIndex] = useState(0);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  const onLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.x;
      const index = Math.round(offset / Math.max(containerWidth, 1));
      if (index >= 0 && index < photos.length) {
        setActiveIndex(index);
      }
    },
    [containerWidth, photos.length],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListingPhotoDto>) => (
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Фото ${index + 1} из ${photos.length}: ${title}`}
        onPress={() => {
          tap();
          setGalleryIndex(index);
        }}
      >
        <Image
          source={{ uri: item.url }}
          style={{ width: containerWidth, aspectRatio: 4 / 3 }}
          resizeMode="cover"
        />
      </Pressable>
    ),
    [containerWidth, photos.length, title],
  );

  return (
    <>
      <Animated.View onLayout={onLayout} style={{ borderRadius: 16, overflow: 'hidden' }}>
        <FlatList
          data={photos}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          getItemLayout={(_, index) => ({
            length: containerWidth,
            offset: containerWidth * index,
            index,
          })}
          extraData={containerWidth}
        />
        {photos.length > 1 ? (
          <View
            style={{
              position: 'absolute',
              bottom: spacing.sm,
              left: 0,
              right: 0,
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {photos.map((photo, index) => (
              <Dot key={photo.id} active={index === activeIndex} />
            ))}
          </View>
        ) : null}
      </Animated.View>

      <PhotoGallery
        photos={photos}
        title={title}
        index={galleryIndex}
        onClose={() => setGalleryIndex(null)}
      />
    </>
  );
}

/** Полноэкранная галерея: свайп между фото, счётчик, закрыть. */
function PhotoGallery({
  photos,
  title,
  index,
  onClose,
}: {
  photos: ListingPhotoDto[];
  title: string;
  index: number | null;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const visible = index !== null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: spacing.md,
          }}
        >
          {/* Фон галереи фиксированно тёмный (не зависит от темы) —
              счётчик честным белым, не токеном темы. */}
          <Text
            style={{ color: '#FFFFFF', fontSize: 15, fontVariant: ['tabular-nums'] }}
          >
            {index !== null ? `${index + 1} / ${photos.length}` : ''}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть галерею"
            onPress={() => {
              tap();
              onClose();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.12)',
            }}
          >
            <Icon name="close" size={24} tint="#FFFFFF" />
          </Pressable>
        </View>

        {visible ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: 'center' }}
            accessibilityLabel={`Галерея: ${title}`}
          >
            {photos.map((photo, photoIndex) => (
              <Image
                key={photo.id}
                source={{ uri: photo.url }}
                style={{ width, flex: 1 }}
                resizeMode="contain"
                accessibilityLabel={`Фото ${photoIndex + 1}: ${title}`}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}
