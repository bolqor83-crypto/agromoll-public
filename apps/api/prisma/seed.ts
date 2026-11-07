/**
 * Сид-скрипт АгроМолл (v0.8.0): полный демо-набор для публичного показа.
 *
 * Наряду с четырьмя легаси-аккаунтами (ФИКСИРОВАННЫЕ id из
 * @agromoll/types.DEMO_ACCOUNTS, v0.3.0) создаёт «живой рынок»:
 * 15 продавцов по линиям 1–15, 5 покупателей-ларёчников, 2 водителя,
 * 1 арбитра, ~40 лотов с фото (внешние URL picsum.photos — S3 для демо
 * не обязателен, ADR-038), брони во всех статусах, долги, споры,
 * блокировку 289-ФЗ с апелляцией и доставки.
 *
 * Вход на проде: AUTH_DEMO_LOGIN=true → код «0000» для любого телефона
 * (v0.8.0-C); в dev — всегда «0000» (ADR-007). Список аккаунтов — docs/DEMO.md.
 *
 * Запуск: pnpm --filter @agromoll/api db:seed
 * Идемпотентен: пользователи — upsert по phone; лоты/брони/долги/споры/
 * доставки — создание пропускается, если объект с тем же естественным
 * ключом уже есть. Повторный прогон не создаёт дублей (проверено юнит-
 * тестом датасета seed.dataset.spec.ts и двойным прогоном на локальном
 * стенде, v0.8.0-F).
 */
import { PrismaClient, type User } from '@prisma/client';
import { DEMO_ACCOUNTS } from '@agromoll/types';
import {
  ARBITRATOR,
  BUYERS,
  DRIVERS,
  LISTINGS,
  SELLERS,
  photoBytes,
  photoUrl,
  type Category,
  type Unit,
} from './seed.dataset';

const prisma = new PrismaClient();

/** Минуты TTL брони — совпадает с дефолтом BOOKING_TTL_MINUTES. */
const BOOKING_TTL_MIN = 30;
const minutes = (m: number) => m * 60_000;
const hours = (h: number) => h * 3_600_000;
const days = (d: number) => d * 86_400_000;

/** Координаты рынка «АгроМолл» (Ростов-на-Дону) и окрестных районов. */
const MARKET_LAT = 47.2479;
const MARKET_LNG = 39.7124;
/** Смещение линии внутри рынка (~10 м между линиями, детерминированное). */
const lineOffset = (line: number): { lat: number; lng: number } => ({
  lat: MARKET_LAT + (line % 5) * 0.0004,
  lng: MARKET_LNG + Math.floor(line / 5) * 0.0006,
});

async function main(): Promise<void> {
  // ─── Легаси-аккаунты v0.3.0 (фиксированные id, upsert) ────────────────
  const legacyBuyer = await prisma.user.upsert({
    where: { id: DEMO_ACCOUNTS.buyer.id },
    update: {},
    create: {
      id: DEMO_ACCOUNTS.buyer.id,
      role: 'buyer',
      displayName: DEMO_ACCOUNTS.buyer.displayName,
      phone: '+79611230001',
      phoneVerified: true,
      reputationScore: 4.2,
    },
  });
  const legacySeller = await prisma.user.upsert({
    where: { id: DEMO_ACCOUNTS.seller.id },
    update: {},
    create: {
      id: DEMO_ACCOUNTS.seller.id,
      role: 'seller',
      displayName: DEMO_ACCOUNTS.seller.displayName,
      phone: '+79611230002',
      phoneVerified: true,
      reputationScore: 4.8,
    },
  });
  const legacyDriver = await prisma.user.upsert({
    where: { id: DEMO_ACCOUNTS.driver.id },
    update: {},
    create: {
      id: DEMO_ACCOUNTS.driver.id,
      role: 'driver',
      displayName: DEMO_ACCOUNTS.driver.displayName,
      phone: '+79611230003',
      phoneVerified: true,
      reputationScore: 4.5,
    },
  });
  await prisma.user.upsert({
    where: { id: DEMO_ACCOUNTS.arbitrator.id },
    update: {},
    create: {
      id: DEMO_ACCOUNTS.arbitrator.id,
      role: 'arbitrator',
      displayName: DEMO_ACCOUNTS.arbitrator.displayName,
      phone: '+79611230004',
      phoneVerified: true,
      reputationScore: 5,
    },
  });

  // ─── v0.8.0-C: демо-рынок (upsert по phone — идемпотентно) ────────────
  const sellers: User[] = [];
  for (const s of SELLERS) {
    sellers.push(
      await prisma.user.upsert({
        where: { phone: s.phone },
        update: {},
        create: {
          role: 'seller',
          displayName: s.name,
          phone: s.phone,
          phoneVerified: true,
          reputationScore: s.rep,
        },
      }),
    );
  }
  const buyers: User[] = [];
  for (const b of BUYERS) {
    buyers.push(
      await prisma.user.upsert({
        where: { phone: b.phone },
        update: {},
        create: {
          role: 'buyer',
          displayName: b.name,
          phone: b.phone,
          phoneVerified: true,
          reputationScore: b.rep,
        },
      }),
    );
  }
  const drivers: User[] = [];
  for (const d of DRIVERS) {
    drivers.push(
      await prisma.user.upsert({
        where: { phone: d.phone },
        update: {},
        create: {
          role: 'driver',
          displayName: d.name,
          phone: d.phone,
          phoneVerified: true,
          reputationScore: d.rep,
        },
      }),
    );
  }
  const arbitrator = await prisma.user.upsert({
    where: { phone: ARBITRATOR.phone },
    update: {},
    create: {
      role: 'arbitrator',
      displayName: ARBITRATOR.name,
      phone: ARBITRATOR.phone,
      phoneVerified: true,
      reputationScore: 5,
    },
  });

  // ─── Лоты (40) + фото (14): пропускаем существующие по (seller, title) ─
  let createdListings = 0;
  let createdPhotos = 0;
  for (const l of LISTINGS) {
    const seller = sellers[l.sellerIdx]!;
    const existing = await prisma.listing.findFirst({
      where: { sellerId: seller.id, title: l.title },
      select: { id: true },
    });
    const listing =
      existing ??
      (await prisma.listing.create({
        data: {
          sellerId: seller.id,
          title: l.title,
          category: l.category,
          unit: l.unit,
          pricePerUnit: l.pricePerUnit,
          quantityAvailable: l.quantityAvailable,
          lineNumber: seller ? SELLERS[l.sellerIdx]!.line : null,
          isPerishable: l.isPerishable ?? false,
          status: 'active',
        },
      }));
    if (!existing) {
      createdListings++;
    }
    if (l.photoSlug) {
      const photoCount = await prisma.listingPhoto.count({ where: { listingId: listing.id } });
      if (photoCount === 0) {
        await prisma.listingPhoto.create({
          data: {
            listingId: listing.id,
            position: 0,
            fileName: `${l.photoSlug}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: photoBytes(l.photoSlug),
            fileUrl: photoUrl(l.photoSlug),
          },
        });
        createdPhotos++;
      }
    }
  }

  // Быстрый доступ к лотам по заголовку (не только созданным сейчас).
  const listingByTitle = new Map<string, { id: string; sellerId: string; title: string }>();
  for (const l of LISTINGS) {
    const found = await prisma.listing.findFirst({
      where: { sellerId: sellers[l.sellerIdx]!.id, title: l.title },
      select: { id: true, sellerId: true, title: true },
    });
    if (found) {
      listingByTitle.set(l.title, found);
    }
  }

  /**
   * Демо-бронь. Естественный ключ идемпотентности — (listing, buyer, status):
   * повторный прогон пропускает существующие пары; «свежесть» requested-
   * броней TTL-крон со временем погасит — следующий прогон сида создаст
   * новые (documented в DEMO.md).
   */
  const booking = async (
    title: string,
    buyerId: string,
    status: 'requested' | 'confirmed' | 'completed' | 'disputed',
    quantity: number,
    ageHours: number,
    extra: Partial<{
      qualityFlag: 'ok' | 'minor_issue' | 'major_issue';
      qualityNotes: string;
    }> = {},
  ): Promise<void> => {
    const listing = listingByTitle.get(title);
    if (!listing) {
      return;
    }
    const existing = await prisma.booking.findFirst({
      where: { listingId: listing.id, buyerId, status },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    const createdAt = new Date(Date.now() - hours(ageHours));
    const expiresAt = new Date(createdAt.getTime() + minutes(BOOKING_TTL_MIN));
    const confirmedAt =
      status === 'requested' ? null : new Date(createdAt.getTime() + minutes(25));
    const deliveryConfirmedAt =
      status === 'completed' ? new Date(createdAt.getTime() + hours(3)) : null;
    const row = await prisma.booking.create({
      data: {
        listingId: listing.id,
        buyerId,
        requestedQuantity: quantity,
        confirmedQuantity: status === 'requested' ? null : quantity,
        status,
        expiresAt,
        confirmedAt,
        deliveryConfirmedAt,
        receivedQuantity: status === 'completed' ? quantity : null,
        qualityFlag: extra.qualityFlag ?? 'ok',
        qualityNotes: extra.qualityNotes ?? null,
        createdAt,
      },
    });
    await prisma.bookingEvent.create({
      data: { bookingId: row.id, actorId: buyerId, action: 'created', payload: { quantity } },
    });
    if (confirmedAt) {
      await prisma.bookingEvent.create({
        data: {
          bookingId: row.id,
          actorId: listing.sellerId,
          action: 'confirmed',
          payload: { quantity },
          createdAt: confirmedAt,
        },
      });
    }
    if (status === 'completed') {
      await prisma.bookingEvent.create({
        data: {
          bookingId: row.id,
          actorId: buyerId,
          action: 'delivery_confirmed',
          payload: { qualityFlag: extra.qualityFlag ?? 'ok' },
          createdAt: deliveryConfirmedAt!,
        },
      });
    }
    if (status === 'disputed') {
      await prisma.bookingEvent.create({
        data: {
          bookingId: row.id,
          actorId: buyerId,
          action: 'delivery_disputed',
          payload: { reason: extra.qualityNotes ?? 'качество' },
        },
      });
    }
  };

  // 17 броней: 3 requested / 5 confirmed / 7 completed / 2 disputed
  await booking('Помидоры розовые', buyers[0]!.id, 'requested', 20, 0.1);
  await booking('Яблоки «Гала»', buyers[1]!.id, 'requested', 25, 0.2);
  await booking('Бананы (Эквадор)', buyers[2]!.id, 'requested', 30, 0.3);
  await booking('Картофель молодой', buyers[3]!.id, 'confirmed', 100, 2);
  await booking('Гречневая крупа', buyers[4]!.id, 'confirmed', 50, 3);
  await booking('Мандарины (Турция)', buyers[0]!.id, 'confirmed', 40, 4);
  await booking('Морковь мытая', buyers[1]!.id, 'confirmed', 60, 5);
  await booking('Масло подсолнечное (бутыль 5 л)', buyers[2]!.id, 'confirmed', 12, 6);
  await booking('Огурцы гладкие', buyers[0]!.id, 'completed', 30, 48);
  await booking('Груши «Конференц»', buyers[1]!.id, 'completed', 15, 50);
  await booking('Лук репчатый (мешок 25 кг)', buyers[2]!.id, 'completed', 4, 72);
  await booking('Сахар-песок', buyers[3]!.id, 'completed', 80, 96);
  await booking('Макаронные изделия', buyers[4]!.id, 'completed', 60, 120, {
    qualityFlag: 'minor_issue',
    qualityNotes: 'Два порванных мешка — пересыпали, недостачи нет',
  });
  await booking('Кабачки', buyers[0]!.id, 'completed', 25, 144);
  await booking('Финики «Маджхоль»', buyers[4]!.id, 'completed', 8, 168);
  // Спорные (предмет демо-споров ниже)
  await booking('Помидоры «Черри»', buyers[1]!.id, 'disputed', 6, 30, {
    qualityFlag: 'major_issue',
    qualityNotes: 'Недогруз: по накладной 6 кг, по факту 4,8 кг',
  });
  await booking('Морковь мытая', buyers[3]!.id, 'disputed', 50, 26, {
    qualityFlag: 'major_issue',
    qualityNotes: 'Треть моркови вялая, подвявшая на солнце',
  });

  // ─── Долги: 4 active + 2 settled (ключ — уникальное description) ──────
  const debt = async (
    creditorId: string,
    debtorId: string,
    amount: number,
    description: string,
    status: 'active' | 'settled',
    ageDays: number,
  ): Promise<void> => {
    const existing = await prisma.debt.findFirst({ where: { description }, select: { id: true } });
    if (existing) {
      return;
    }
    const createdAt = new Date(Date.now() - days(ageDays));
    const row = await prisma.debt.create({
      data: {
        creditorId,
        debtorId,
        amount,
        description,
        status,
        createdAt,
        settledAt: status === 'settled' ? new Date(createdAt.getTime() + days(2)) : null,
      },
    });
    await prisma.debtEvent.create({
      data: {
        debtId: row.id,
        actorId: creditorId,
        action: 'created',
        payload: { amount: String(amount), currency: 'RUB' },
        createdAt,
      },
    });
    if (status === 'settled') {
      await prisma.debtEvent.create({
        data: {
          debtId: row.id,
          actorId: debtorId,
          action: 'settled',
          payload: { amount: String(amount) },
          createdAt: new Date(createdAt.getTime() + days(2)),
        },
      });
    }
  };

  await debt(sellers[2]!.id, buyers[0]!.id, 4_100, 'Картофель молодой, 100 кг — отсрочка недели', 'active', 12);
  await debt(sellers[5]!.id, buyers[4]!.id, 3_400, 'Бакалея: гречка + сахар, отсрочка 5 дней', 'active', 5);
  await debt(sellers[11]!.id, buyers[2]!.id, 2_200, 'Сухарики и чипсы, ящик под реализацию', 'active', 20);
  await debt(drivers[0]!.id, buyers[1]!.id, 850, 'Доставка: рынок → ларёк у вокзала', 'active', 2);
  await debt(sellers[1]!.id, buyers[0]!.id, 5_600, 'Яблоки «Гала», 80 кг — частичная оплата', 'settled', 30);
  await debt(sellers[8]!.id, buyers[3]!.id, 2_280, 'Морковь мытая, 60 кг', 'settled', 45);

  // ─── Споры: 1 under_review + 1 resolved (ключ — уникальный subject) ───
  const disputeUnderReview = 'Спор: помидоры «Черри» — недогруз 1,2 кг';
  if ((await prisma.disputeCase.count({ where: { subject: disputeUnderReview } })) === 0) {
    const listing = listingByTitle.get('Помидоры «Черри»');
    const disputedBooking = listing
      ? await prisma.booking.findFirst({
          where: { listingId: listing.id, buyerId: buyers[1]!.id, status: 'disputed' },
        })
      : null;
    if (disputedBooking) {
      const c = await prisma.disputeCase.create({
        data: {
          type: 'booking',
          referenceId: disputedBooking.id,
          firstPartyId: buyers[1]!.id,
          secondPartyId: sellers[13]!.id,
          openedById: buyers[1]!.id,
          status: 'under_review',
          assignedToId: arbitrator.id,
          assignedAt: new Date(Date.now() - hours(20)),
          subject: disputeUnderReview,
        },
      });
      await prisma.disputeMessage.createMany({
        data: [
          {
            disputeId: c.id,
            authorId: buyers[1]!.id,
            body: 'Забрал 6 кг черри по накладной, дома взвесил — 4,8 кг. Фото весов приложил.',
          },
          {
            disputeId: c.id,
            authorId: sellers[13]!.id,
            body: 'Взвешивали при покупателе на рынке, весы поверенные. Приехал бы сразу — пересмотрели бы.',
          },
          {
            disputeId: c.id,
            authorId: arbitrator.id,
            body: 'Прошу обе стороны приложить фото накладной и весов до конца дня. Решение — завтра.',
          },
        ],
      });
    }
  }

  const disputeResolved = 'Спор: морковь мытая — качество при приёмке';
  if ((await prisma.disputeCase.count({ where: { subject: disputeResolved } })) === 0) {
    const listing = listingByTitle.get('Морковь мытая');
    const disputedBooking = listing
      ? await prisma.booking.findFirst({
          where: { listingId: listing.id, buyerId: buyers[3]!.id, status: 'disputed' },
        })
      : null;
    if (disputedBooking) {
      const c = await prisma.disputeCase.create({
        data: {
          type: 'booking',
          referenceId: disputedBooking.id,
          firstPartyId: buyers[3]!.id,
          secondPartyId: sellers[8]!.id,
          openedById: buyers[3]!.id,
          status: 'resolved',
          assignedToId: arbitrator.id,
          assignedAt: new Date(Date.now() - days(3)),
          resolution: 'favor_buyer',
          resolvedById: arbitrator.id,
          resolvedAt: new Date(Date.now() - days(2)),
          notes: 'Возврат 15% стоимости, продавцу предупреждение о хранении на солнце.',
          subject: disputeResolved,
        },
      });
      await prisma.disputeMessage.createMany({
        data: [
          {
            disputeId: c.id,
            authorId: buyers[3]!.id,
            body: 'Треть мешка вялая, фотография прикладываю. Просрочка недопустима для реализации.',
          },
          {
            disputeId: c.id,
            authorId: arbitrator.id,
            body: 'Решение: прав покупатель. Возврат 15%, предупреждение продавцу.',
          },
        ],
      });
    }
  }

  // ─── Блокировка 289-ФЗ (новая пара) + апелляция under_review ──────────
  // Легаси-блокировка пары DEMO driver↔seller создаётся ниже (v0.6.0-E).
  let newBlock = await prisma.blockedPair.findFirst({
    where: { driverId: drivers[0]!.id, sellerId: sellers[4]!.id, unblockedAt: null },
  });
  if (!newBlock) {
    newBlock = await prisma.blockedPair.create({
      data: {
        driverId: drivers[0]!.id,
        sellerId: sellers[4]!.id,
        reason: 'По 289-ФЗ нужна пауза: 6 месяцев подряд по 60+ часов',
      },
    });
  }
  const appealReason = 'Фактические смены были по 40–45 часов, в учёте ошибка: две смены задвоены';
  if ((await prisma.appealCase.count({ where: { reason: appealReason } })) === 0) {
    const appeal = await prisma.appealCase.create({
      data: {
        blockedPairId: newBlock.id,
        driverId: drivers[0]!.id,
        sellerId: sellers[4]!.id,
        appellantId: drivers[0]!.id,
        status: 'under_review',
        assignedToId: arbitrator.id,
        assignedAt: new Date(Date.now() - hours(30)),
        reason: appealReason,
      },
    });
    await prisma.appealMessage.createMany({
      data: [
        {
          appealId: appeal.id,
          authorId: drivers[0]!.id,
          body: 'Работал у Иване с мая, смены по 8–9 часов три раза в неделю. В журнале задвоены две субботы — я в эти дни возил для линии 9.',
        },
        {
          appealId: appeal.id,
          authorId: arbitrator.id,
          body: 'Запросил журнал смен у обеих сторон. Сверю с записями линии 9, решение в течение двух дней.',
        },
      ],
    });
  }

  // ─── Доставки: open / assigned / delivered (ключ — description) ────────
  const geoPoint = async (
    ownerId: string,
    kind: 'seller_line' | 'buyer_point',
    lat: number,
    lng: number,
    label: string,
    address: string,
  ): Promise<string> => {
    const existing = await prisma.geoPoint.findFirst({
      where: { ownerId, kind, label },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }
    const p = await prisma.geoPoint.create({
      data: { ownerId, kind, latitude: lat, longitude: lng, label, address },
    });
    return p.id;
  };

  const delivery = async (
    description: string,
    buyerId: string,
    sellerIdx: number,
    weightKg: number,
    status: 'open' | 'assigned' | 'delivered',
    ageHours: number,
    driverIdx?: number,
  ): Promise<void> => {
    const existing = await prisma.deliveryRequest.findFirst({
      where: { description },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    const seller = sellers[sellerIdx]!;
    const line = lineOffset(SELLERS[sellerIdx]!.line);
    const buyerIdx = buyers.findIndex((b) => b.id === buyerId);
    const buyerGeo = [
      { lat: 47.2639, lng: 39.717, addr: 'ЗЖМ, ул. Текучева, ларёк «Заря»' },
      { lat: 47.2172, lng: 39.7437, addr: 'Ростов-Главный, ларёк у вокзала' },
      { lat: 47.2033, lng: 39.634, addr: 'Левенцовка, павильон «Продукты»' },
      { lat: 47.2304, lng: 39.6405, addr: 'Западный, ларёк «Уют»' },
      { lat: 47.2314, lng: 39.7264, addr: 'Студенческая, кафе-ларёк' },
    ][buyerIdx >= 0 ? buyerIdx : 0]!;
    const pickup = await geoPoint(
      seller.id,
      'seller_line',
      line.lat,
      line.lng,
      `Линия ${SELLERS[sellerIdx]!.line}`,
      `АгроМолл, линия ${SELLERS[sellerIdx]!.line}`,
    );
    const dropoff = await geoPoint(
      buyerId,
      'buyer_point',
      buyerGeo.lat,
      buyerGeo.lng,
      'Точка покупателя',
      buyerGeo.addr,
    );
    const createdAt = new Date(Date.now() - hours(ageHours));
    const row = await prisma.deliveryRequest.create({
      data: {
        buyerId,
        pickupPointId: pickup,
        dropoffPointId: dropoff,
        weightKg,
        description,
        status,
        assignedDriverId:
          status === 'open' ? null : drivers[driverIdx ?? 1]!.id,
        assignedAt: status === 'open' ? null : new Date(createdAt.getTime() + minutes(15)),
        deliveredAt:
          status === 'delivered' ? new Date(createdAt.getTime() + minutes(50)) : null,
        expiresAt: new Date(createdAt.getTime() + minutes(60)),
        pickupCode: crypto.randomUUID(),
        dropoffCode: crypto.randomUUID(),
        createdAt,
      },
    });
    await prisma.deliveryEvent.create({
      data: { deliveryId: row.id, actorId: buyerId, action: 'created', payload: { weightKg } },
    });
    if (status !== 'open') {
      await prisma.deliveryEvent.create({
        data: {
          deliveryId: row.id,
          actorId: drivers[driverIdx ?? 1]!.id,
          action: 'assigned',
          createdAt: new Date(createdAt.getTime() + minutes(15)),
        },
      });
    }
    if (status === 'delivered') {
      await prisma.deliveryEvent.create({
        data: {
          deliveryId: row.id,
          actorId: drivers[driverIdx ?? 1]!.id,
          action: 'delivered',
          createdAt: new Date(createdAt.getTime() + minutes(50)),
        },
      });
    }
  };

  await delivery('Картофель молодой, 4 мешка — линия 3 → ларёк «Уют»', buyers[3]!.id, 2, 100, 'open', 0.2);
  await delivery('Бакалея: гречка + сахар — линия 6 → кафе «Студенческий»', buyers[4]!.id, 5, 60, 'assigned', 0.7, 1);
  await delivery('Помидоры и огурцы, 2 ящика — линия 1 → ларёк «Заря»', buyers[0]!.id, 0, 40, 'delivered', 24, 0);

  // ─── Легаси-данные v0.3–v0.6 (как раньше, идемпотентно) ────────────────
  const legacyListings: Array<{
    title: string;
    category: Category;
    unit: Unit;
    pricePerUnit: number;
    quantityAvailable: number;
    lineNumber: number;
    isPerishable: boolean;
  }> = [
    { title: 'Помидоры розовые (демо)', category: 'vegetables', unit: 'kg', pricePerUnit: 85.5, quantityAvailable: 120, lineNumber: 12, isPerishable: true },
    { title: 'Лук репчатый, ящик (демо)', category: 'vegetables', unit: 'box', pricePerUnit: 640, quantityAvailable: 25, lineNumber: 4, isPerishable: false },
    { title: 'Картофель молодой (демо)', category: 'vegetables', unit: 'kg', pricePerUnit: 41, quantityAvailable: 400, lineNumber: 8, isPerishable: false },
    { title: 'Яблоки гала (демо)', category: 'fruits', unit: 'kg', pricePerUnit: 60, quantityAvailable: 80, lineNumber: 3, isPerishable: true },
    { title: 'Сухарики «Три корочки», коробка (демо)', category: 'snacks', unit: 'box', pricePerUnit: 1250, quantityAvailable: 10, lineNumber: 21, isPerishable: false },
  ];
  for (const l of legacyListings) {
    const existing = await prisma.listing.findFirst({
      where: { sellerId: legacySeller.id, title: l.title },
      select: { id: true },
    });
    if (!existing) {
      await prisma.listing.create({
        data: {
          sellerId: legacySeller.id,
          title: l.title,
          category: l.category,
          unit: l.unit,
          pricePerUnit: l.pricePerUnit,
          quantityAvailable: l.quantityAvailable,
          lineNumber: l.lineNumber,
          isPerishable: l.isPerishable,
          status: 'active',
        },
      });
    }
  }

  const existingDebts = await prisma.debt.count({ where: { creditorId: legacySeller.id } });
  if (existingDebts === 0) {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
    await prisma.debt.create({
      data: {
        creditorId: legacySeller.id,
        debtorId: legacyBuyer.id,
        amount: 12_500,
        description: 'Помидоры розовые, 2 ящика',
        status: 'active',
      },
    });
    const firstDebt = await prisma.debt.findFirstOrThrow({
      where: { creditorId: legacySeller.id },
    });
    await prisma.debtEvent.create({
      data: {
        debtId: firstDebt.id,
        actorId: legacySeller.id,
        action: 'created',
        payload: { amount: '12500', currency: 'RUB' },
      },
    });
    await prisma.debt.create({
      data: {
        creditorId: DEMO_ACCOUNTS.driver.id,
        debtorId: legacyBuyer.id,
        amount: 800.5,
        description: 'Доставка до Левенцовки',
        status: 'active',
        createdAt: daysAgo(2),
      },
    });
  }

  const month = new Date().toISOString().slice(0, 7);
  if ((await prisma.workSession.count({ where: { driverId: legacyDriver.id } })) === 0) {
    const startedAt = new Date(Date.now() - 5 * 3_600_000);
    await prisma.workSession.create({
      data: {
        driverId: legacyDriver.id,
        sellerId: legacySeller.id,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 3 * 3_600_000),
        durationMinutes: 180,
        month,
      },
    });
    await prisma.monthlyPairTotal.upsert({
      where: {
        driverId_sellerId_month: { driverId: legacyDriver.id, sellerId: legacySeller.id, month },
      },
      create: {
        driverId: legacyDriver.id,
        sellerId: legacySeller.id,
        month,
        totalMinutes: 180,
        monthCounted: false,
      },
      update: {},
    });
  }

  if (
    !(await prisma.blockedPair.findFirst({
      where: { driverId: legacyDriver.id, sellerId: legacySeller.id, unblockedAt: null },
    }))
  ) {
    await prisma.blockedPair.create({
      data: {
        driverId: legacyDriver.id,
        sellerId: legacySeller.id,
        reason: 'По 289-ФЗ нужна пауза: 6 месяцев подряд по 60+ часов',
      },
    });
  }

  // ─── Итог ──────────────────────────────────────────────────────────────
  const counts = {
    sellers: await prisma.user.count({ where: { role: 'seller' } }),
    buyers: await prisma.user.count({ where: { role: 'buyer' } }),
    drivers: await prisma.user.count({ where: { role: 'driver' } }),
    arbitrators: await prisma.user.count({ where: { role: 'arbitrator' } }),
    listings: await prisma.listing.count(),
    photos: await prisma.listingPhoto.count(),
    bookings: await prisma.booking.count(),
    debts: await prisma.debt.count(),
    disputes: await prisma.disputeCase.count(),
    appeals: await prisma.appealCase.count(),
    deliveries: await prisma.deliveryRequest.count(),
  };
  console.log('Сид завершён (создано сейчас):');
  console.log(`  лотов: +${createdListings}, фото: +${createdPhotos}`);
  console.log('Всего в БД:', JSON.stringify(counts));
  console.log(`  демо-вход: покупатель ${BUYERS[0]!.phone}, продавец ${SELLERS[0]!.phone},`);
  console.log(`  водитель ${DRIVERS[0]!.phone}, арбитр ${ARBITRATOR.phone} — код «0000» (см. docs/DEMO.md)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
