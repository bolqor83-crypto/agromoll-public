/**
 * Сервис листингов: витрина продавца и лента покупателя.
 *
 * Создавать лоты может только seller (проверяется ролями на контроллере),
 * изменять — только владелец лота (403 в сервисе, защита в глубину).
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Listing, Prisma } from '@prisma/client';
import type { ListingDto, ListingCategory, ListingStatus } from '@agromoll/types';
import type { CreateListingInput, UpdateListingInput } from '@agromoll/validation';
import { PrismaService } from '../prisma/prisma.service';
import { toListingDto } from '../common/serialization';

export interface ListingFilters {
  category?: ListingCategory;
  status?: ListingStatus;
  lineNumber?: number;
}

/** Include продавца для карточек ленты. */
const SELLER_INCLUDE = {
  seller: { select: { displayName: true } },
} as const satisfies Prisma.ListingInclude;

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: SELLER_INCLUDE,
      take: 200,
    });
    return listings.map(toListingDto);
  }

  async findOne(id: string): Promise<ListingDto> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: SELLER_INCLUDE,
    });
    if (!listing) {
      throw new NotFoundException('Лот не найден');
    }
    return toListingDto(listing);
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
      include: SELLER_INCLUDE,
    });
    return listings.map(toListingDto);
  }
}
