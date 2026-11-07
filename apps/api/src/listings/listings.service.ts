/**
 * Сервис листингов: витрина продавца и лента покупателя.
 *
 * Создавать лоты может только seller (проверяется ролями на контроллере),
 * изменять — только владелец лота (403 в сервисе, защита в глубину).
 *
 * v0.7.0-D (ADR-038): фото товаров — до 5 на лот. Механика зеркалит
 * доказательства споров (ADR-036): presigned PUT → confirm с objectKey
 * (сверка HEAD-ом) либо fallback data:-URL ≤ 500 КБ. Разница принципиальная:
 * доказательства — участник спора в АКТИВНОМ кейсе, фото — владелец лота
 * в любом статусе (архивный лот можно сфотографировать заново — ошибки
 * в один клик исправляются без заведения кейса).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Listing, ListingPhoto, Prisma } from '@prisma/client';
import type {
  ListingDto,
  ListingCategory,
  ListingPhotoDto,
  ListingStatus,
} from '@agromoll/types';
import type {
  AttachListingPhotoInput,
  CreateListingInput,
  ListingPhotoUploadUrlInput,
  UpdateListingInput,
} from '@agromoll/validation';
import { LISTING_MAX_PHOTOS } from '@agromoll/validation';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  S3_URL_SCHEME,
  keyBelongsToListing,
  s3KeyFromFileUrl,
} from '../storage/storage.constants';
import { toListingDto } from '../common/serialization';

export interface ListingFilters {
  category?: ListingCategory;
  status?: ListingStatus;
  lineNumber?: number;
}

/** Include продавца для карточек ленты + рейтинг для бейджа (ADR-013). */
const SELLER_INCLUDE = {
  seller: {
    select: {
      displayName: true,
      reputation: { select: { score: true, dealsCount: true } },
    },
  },
} as const satisfies Prisma.ListingInclude;

/** Include фото для ДЕТАЛЕЙ лота: все поля, по порядку карусели. */
const PHOTOS_INCLUDE = {
  photos: { orderBy: { position: 'asc' as const } },
} as const satisfies Prisma.ListingInclude;

/** Include обложки для СПИСКОВ: только fileUrl первого фото — тащить
 *  пятёрку полных строк (с data:-URL до 500 КБ) в каждый элемент ленты незачем. */
const COVER_INCLUDE = {
  photos: {
    orderBy: { position: 'asc' as const },
    take: 1,
    select: { fileUrl: true },
  },
} as const satisfies Prisma.ListingInclude;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Создание лота. pricePerUnit проверяется схемой zod до сервиса. */
  async create(sellerId: string, input: CreateListingInput): Promise<ListingDto> {
    const listing = await this.prisma.listing.create({
      data: {
        sellerId,
        title: input.title,
        category: input.category,
        unit: input.unit,
        pricePerUnit: input.pricePerUnit,
        quantityAvailable: input.quantityAvailable,
        lineNumber: input.lineNumber,
        isPerishable: input.isPerishable,
        status: 'active',
      },
      include: SELLER_INCLUDE,
    });
    return toListingDto(listing);
  }

  /**
   * Лента листингов с фильтрами. Без явного status показываем только
   * активные — это лента покупателя, а не архив продавца.
   *
   * coverUrl — обложка (первое фото) или null: карточка ленты без фото
   * показывает иконку категории, с фото — само фото (v0.7.0-D).
   */
  async findMany(filters: ListingFilters): Promise<ListingDto[]> {
    const where: Prisma.ListingWhereInput = {
      category: filters.category,
      status: filters.status ?? 'active',
      lineNumber: filters.lineNumber,
    };
    const listings = await this.prisma.listing.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: { ...SELLER_INCLUDE, ...COVER_INCLUDE },
      take: 200,
    });
    return Promise.all(
      listings.map(async (listing) => ({
        ...toListingDto(listing),
        coverUrl: await this.photoUrl(listing.photos[0]?.fileUrl),
      })),
    );
  }

  /** Детали лота: все фото с ссылками для карусели + галереи (v0.7.0-D). */
  async findOne(id: string): Promise<ListingDto> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { ...SELLER_INCLUDE, ...PHOTOS_INCLUDE },
    });
    if (!listing) {
      throw new NotFoundException('Лот не найден');
    }
    return {
      ...toListingDto(listing),
      coverUrl: await this.photoUrl(listing.photos[0]?.fileUrl),
      photos: await Promise.all(listing.photos.map((photo) => this.toPhotoDto(photo))),
    };
  }

  /** Частичное обновление. Только владелец лота. */
  async update(id: string, actorId: string, input: UpdateListingInput): Promise<ListingDto> {
    const existing = await this.prisma.listing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Лот не найден');
    }
    if (existing.sellerId !== actorId) {
      throw new ForbiddenException('Изменить лот может только его владелец');
    }
    if (
      input.quantityAvailable !== undefined &&
      input.quantityAvailable < existing.quantityReserved
    ) {
      throw new ConflictException(
        `Нельзя уменьшить доступное количество ниже резерва (${existing.quantityReserved})`,
      );
    }

    const data: Prisma.ListingUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.category !== undefined) data.category = input.category;
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.pricePerUnit !== undefined) data.pricePerUnit = input.pricePerUnit;
    if (input.quantityAvailable !== undefined) data.quantityAvailable = input.quantityAvailable;
    if (input.lineNumber !== undefined) data.lineNumber = input.lineNumber;
    if (input.isPerishable !== undefined) data.isPerishable = input.isPerishable;
    if (input.status !== undefined) data.status = input.status;

    const updated: Listing & { seller: { displayName: string } | null } =
      await this.prisma.listing.update({
        where: { id },
        data,
        include: SELLER_INCLUDE,
      });
    return toListingDto(updated);
  }

  /** Мои лоты продавца (для витрины). */
  async findMine(sellerId: string): Promise<ListingDto[]> {
    const listings = await this.prisma.listing.findMany({
      where: { sellerId },
      orderBy: [{ createdAt: 'desc' }],
      include: { ...SELLER_INCLUDE, ...COVER_INCLUDE },
    });
    return Promise.all(
      listings.map(async (listing) => ({
        ...toListingDto(listing),
        coverUrl: await this.photoUrl(listing.photos[0]?.fileUrl),
      })),
    );
  }

  // ─── Фото товаров (v0.7.0-D, ADR-038) ────────────────────────────────────

  /**
   * Presigned URL для прямой загрузки фото (владелец лота).
   *
   * Файл идёт клиент → хранилище напрямую, API только подписывает ссылку.
   * Хранилище не настроено/недоступно → 503: клиент обязан упасть в
   * fallback (data:-URL ≤ 500 КБ), а не показывать общий «сервер недоступен».
   */
  async createPhotoUploadUrl(
    actorId: string,
    listingId: string,
    input: ListingPhotoUploadUrlInput,
  ): Promise<{ objectKey: string; uploadUrl: string; expiresIn: number }> {
    await this.loadOwnedListing(listingId, actorId);

    if (!this.storage.isAvailable()) {
      throw new ServiceUnavailableException(
        'Хранилище файлов не настроено — прикрепите фото файлом (fallback)',
      );
    }

    return this.storage.presignPut(
      this.storage.listingPhotoObjectKey(listingId, input.mimeType),
      input.mimeType,
    );
  }

  /**
   * Приложить фото (владелец лота). Позиция — следующая свободная
   * (append): порядок задаётся порядком загрузки, перетаскивание
   * в MVP не нужно (первые фото — самые важные, грузятся первыми).
   *
   *  - s3: ключ выдан для ЭТОГО лота, объект существует (HEAD), размер/тип
   *    совпадают с заявленными — «мёртвых» ссылок и лжи в метаданных нет;
   *  - data: fallback ≤ 500 КБ (лимит — zod-схемой), сверка MIME из URL.
   */
  async attachPhoto(
    actorId: string,
    listingId: string,
    input: AttachListingPhotoInput,
  ): Promise<ListingPhotoDto> {
    await this.loadOwnedListing(listingId, actorId);

    const count = await this.prisma.listingPhoto.count({ where: { listingId } });
    if (count >= LISTING_MAX_PHOTOS) {
      throw new ConflictException(`У лота уже ${LISTING_MAX_PHOTOS} фото — максимум`);
    }

    let fileUrl: string;
    let sizeBytes: number;
    let mimeType: string;

    if (input.storage === 's3') {
      if (!this.storage.isAvailable()) {
        throw new ServiceUnavailableException(
          'Хранилище файлов не настроено — прикрепите фото файлом (fallback)',
        );
      }
      if (!keyBelongsToListing(input.objectKey, listingId)) {
        throw new BadRequestException(
          'objectKey принадлежит другому лоту — запросите ссылку заново',
        );
      }
      const head = await this.storage.headObject(input.objectKey);
      if (!head) {
        throw new BadRequestException(
          'Файл не найден в хранилище — сначала загрузите его по presigned URL',
        );
      }
      if (head.sizeBytes !== input.sizeBytes) {
        throw new BadRequestException(
          `Размер файла в хранилище (${head.sizeBytes} Б) отличается от заявленного (${input.sizeBytes} Б)`,
        );
      }
      if (head.mimeType && head.mimeType !== input.mimeType) {
        throw new BadRequestException(
          `Тип файла в хранилище (${head.mimeType}) отличается от заявленного (${input.mimeType})`,
        );
      }
      fileUrl = `${S3_URL_SCHEME}${input.objectKey}`;
      sizeBytes = input.sizeBytes;
      mimeType = input.mimeType;
    } else {
      // Сверка MIME из data:-URL с заявленным (путаница типов сломает рендер).
      const declaredInUrl = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(input.dataUrl)?.[1];
      if (declaredInUrl && declaredInUrl !== input.mimeType) {
        throw new BadRequestException(
          `Тип в dataUrl (${declaredInUrl}) отличается от заявленного mimeType (${input.mimeType})`,
        );
      }
      fileUrl = input.dataUrl;
      sizeBytes = decodedSizeBytes(input.dataUrl.slice(input.dataUrl.indexOf(',') + 1));
      mimeType = input.mimeType;
    }

    // Позиция = count: UNIQUE(listingId, position) страхует от гонки —
    // параллельный attach того же слота получит P2002 → 409 у клиента.
    const photo = await this.prisma.listingPhoto.create({
      data: {
        listingId,
        position: count,
        fileName: input.fileName,
        mimeType,
        sizeBytes,
        fileUrl,
      },
    });
    return this.toPhotoDto(photo);
  }

  /**
   * Удалить фото (владелец лота). Позиции пересобираются: после
   * удаления обложки (position 0) обложкой становится следующее фото,
   * дыр в нумерации не остаётся — обложка всегда ищется по position 0.
   */
  async deletePhoto(actorId: string, listingId: string, photoId: string): Promise<{ id: string }> {
    await this.loadOwnedListing(listingId, actorId);

    const photo = await this.prisma.listingPhoto.findFirst({
      where: { id: photoId, listingId },
    });
    if (!photo) {
      throw new NotFoundException('Фото не найдено у этого лота');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.listingPhoto.delete({ where: { id: photo.id } });
      // Пересборка позиций: оставшиеся по порядку получают 0..n-1.
      const remaining = await tx.listingPhoto.findMany({
        where: { listingId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      for (const [index, row] of remaining.entries()) {
        await tx.listingPhoto.update({
          where: { id: row.id },
          data: { position: index },
        });
      }
    });

    return { id: photo.id };
  }

  /** Загрузка лота с проверкой владельца: 404/403 — единая точка для фото. */
  private async loadOwnedListing(
    listingId: string,
    actorId: string,
  ): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) {
      throw new NotFoundException('Лот не найден');
    }
    if (listing.sellerId !== actorId) {
      throw new ForbiddenException('Добавить фото может только владелец лота');
    }
    return listing;
  }

  /** fileUrl строки фото → ссылка для показа: presigned GET или data: как есть. */
  private async photoUrl(fileUrl: string | null | undefined): Promise<string | null> {
    if (!fileUrl) {
      return null;
    }
    const objectKey = s3KeyFromFileUrl(fileUrl);
    if (!objectKey) {
      return fileUrl; // data:-URL (fallback) — уже готов к рендеру
    }
    if (!this.storage.isAvailable()) {
      // Хранилище легло ПОСЛЕ загрузки: отдаём постоянную форму s3:// —
      // клиент покажет заглушку, а не упадёт (деградация, не падение).
      return fileUrl;
    }
    return this.storage.presignGet(objectKey);
  }

  /** Строка БД → DTO фото со ссылкой для показа. */
  private async toPhotoDto(photo: ListingPhoto): Promise<ListingPhotoDto> {
    return {
      id: photo.id,
      position: photo.position,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      url: (await this.photoUrl(photo.fileUrl)) ?? photo.fileUrl,
    };
  }
}

/** Размер декодированного base64 (без Buffer — работает и на edge). */
function decodedSizeBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
