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

  // Ширина контейнера — единственный источник правды для пейджинга.
  // Гард против аномалий лэйаута (RN-web: горизонтальный FlatList без
  // явной ширины может распереть родителя — ширина растёт с каждым
  // onLayout до сатурации LayoutUnit): игнорируем всё, что шире
  // окна (контентная колонка ≤ 600 px, окно — верхняя граница).
  const onLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      const width = event.nativeEvent.layout.width;
      if (width > 0 && width <= windowWidth) {
        setContainerWidth(width);
      }
    },
    [windowWidth],
  );

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
      {/* width:'100%' — обязателен на RN-web: родитель с alignItems:'center'
          даёт обёртке сжаться до контента, а горизонтальный FlatList
          распирает её (цикл onLayout → рост ширины). 100% — ширина
          морф-фрейма 4:3 из ListingDetailScreen, как задумано. */}
      <Animated.View
        onLayout={onLayout}
        style={{ width: '100%', borderRadius: 16, overflow: 'hidden' }}
      >
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
          style={{ width: '100%' }}
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
  // Высота зоны фото: % внутри контента ScrollView не резолвятся на
  // RN-web (контейнер авто-высоты → 0) — меряем сам ScrollView и
  // задаём страницам явные пиксели.
  const [scrollHeight, setScrollHeight] = useState(0);

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
            // flex:1 — занимает всё под шапкой; высота меряется onLayout
            // и задаётся страницам явно (иначе RN-web даст 0).
            style={{ flex: 1 }}
            onLayout={(event) => setScrollHeight(event.nativeEvent.layout.height)}
            contentContainerStyle={{ alignItems: 'center' }}
            accessibilityLabel={`Галерея: ${title}`}
          >
            {photos.map((photo, photoIndex) => (
              <View key={photo.id} style={{ width, height: scrollHeight || '100%' }}>
                <Image
                  source={{ uri: photo.url }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                  accessibilityLabel={`Фото ${photoIndex + 1}: ${title}`}
                />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}
