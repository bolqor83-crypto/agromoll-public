/**
 * Сид-скрипт АгроМолл (v0.3.0): демо-аккаунты и витрина.
 *
 * Создаёт трёх пользователей с ФИКСИРОВАННЫМИ id из @agromoll/types.DEMO_ACCOUNTS
 * и телефонами: в dev на них можно войти по коду-заглушке «0000»
 * (POST /auth/request-code → POST /auth/verify, см. ADR-007).
 * Парольного входа в MVP нет — passwordHash не заполняется (колонка
 * заложена на будущее); телефон — единственный идентификатор входа.
 *
 * Запуск: pnpm --filter @agromoll/api db:seed
 * Идемпотентен: upsert по id.
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_ACCOUNTS } from '@agromoll/types';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const buyer = await prisma.user.upsert({
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

  const seller = await prisma.user.upsert({
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

  await prisma.user.upsert({
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

  const listings: Array<{
    title: string;
    category: 'vegetables' | 'fruits' | 'grocery' | 'snacks' | 'other';
    unit: 'kg' | 'box' | 'piece';
    pricePerUnit: number;
    quantityAvailable: number;
    lineNumber: number;
    isPerishable: boolean;
  }> = [
    {
      title: 'Помидоры розовые',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: 85.5,
      quantityAvailable: 120,
      lineNumber: 12,
      isPerishable: true,
    },
    {
      title: 'Лук репчатый, ящик',
      category: 'vegetables',
      unit: 'box',
      pricePerUnit: 640,
      quantityAvailable: 25,
      lineNumber: 4,
      isPerishable: false,
    },
    {
      title: 'Картофель молодой',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: 41,
      quantityAvailable: 400,
      lineNumber: 8,
      isPerishable: false,
    },
    {
      title: 'Яблоки гала',
      category: 'fruits',
      unit: 'kg',
      pricePerUnit: 60,
      quantityAvailable: 80,
      lineNumber: 3,
      isPerishable: true,
    },
    {
      title: 'Сухарики «Три корочки», коробка',
      category: 'snacks',
      unit: 'box',
      pricePerUnit: 1250,
      quantityAvailable: 10,
      lineNumber: 21,
      isPerishable: false,
    },
  ];

  for (const l of listings) {
    const existing = await prisma.listing.findFirst({
      where: { sellerId: seller.id, title: l.title },
      select: { id: true },
    });
    if (existing) {
      continue; // уже засеяно — не дублируем
    }
    await prisma.listing.create({
      data: {
        sellerId: seller.id,
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

  // ─── Демо-долги (v0.4.0, ADR-010) ──────────────────────────────────
  // Идемпотентно: не создаём дубли при повторном прогоне сида.
  const existingDebts = await prisma.debt.count({
    where: { creditorId: seller.id },
  });
  if (existingDebts === 0) {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

    // продавец отпустил покупателю в долг (активный, просрочка >30 дней)
    await prisma.debt.create({
      data: {
        creditorId: seller.id,
        debtorId: buyer.id,
        amount: 12_500,
        description: 'Помидоры розовые, 2 ящика',
        status: 'active',
      },
    });
    await prisma.debtEvent.create({
      data: {
        debtId: (await prisma.debt.findFirstOrThrow({ where: { creditorId: seller.id } })).id,
        actorId: seller.id,
        action: 'created',
        payload: { amount: '12500', currency: 'RUB' },
      },
    });

    // покупатель должен водителю за доставку (молодой активный)
    await prisma.debt.create({
      data: {
        creditorId: DEMO_ACCOUNTS.driver.id,
        debtorId: buyer.id,
        amount: 800.5,
        description: 'Доставка до Левенцовки',
        status: 'active',
        createdAt: daysAgo(2),
      },
    });

    console.log('  долгов:    2 (активные: просроченный + молодой)');
  }

  // ─── Демо-сессии часов (v0.4.0, ADR-011) ───────────────────────────
  // Водитель отработал смену у продавца: сессия + месячный итог.
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const existingSession = await prisma.workSession.count({
    where: { driverId: DEMO_ACCOUNTS.driver.id },
  });
  if (existingSession === 0) {
    const startedAt = new Date(Date.now() - 5 * 3_600_000);
    await prisma.workSession.create({
      data: {
        driverId: DEMO_ACCOUNTS.driver.id,
        sellerId: seller.id,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 3 * 3_600_000),
        durationMinutes: 180,
        month,
      },
    });
    await prisma.monthlyPairTotal.upsert({
      where: {
        driverId_sellerId_month: {
          driverId: DEMO_ACCOUNTS.driver.id,
          sellerId: seller.id,
          month,
        },
      },
      create: {
        driverId: DEMO_ACCOUNTS.driver.id,
        sellerId: seller.id,
        month,
        totalMinutes: 180,
        monthCounted: false,
      },
      update: {},
    });
    console.log('  часов:     1 смена (3 ч у продавца)');
  }

  console.log('Сид завершён:');
  console.log(`  покупатель: ${buyer.displayName} (${buyer.id})`);
  console.log(`  продавец:   ${seller.displayName} (${seller.id})`);
  console.log(`  доставщик:  ${DEMO_ACCOUNTS.driver.displayName} (${DEMO_ACCOUNTS.driver.id})`);
  console.log(`  лотов:      ${listings.length}`);
  console.log('X-User-Id для ручной проверки API = id выше.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
