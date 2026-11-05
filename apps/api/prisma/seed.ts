/**
 * Сид-скрипт АгроМолл (v0.2.0): демо-аккаунты и витрина.
 *
 * Создаёт трёх пользователей с ФИКСИРОВАННЫМИ id из @agromoll/types.DEMO_ACCOUNTS
 * (мобильное приложение подставляет их в X-User-Id — заглушка auth) и несколько
 * активных лотов, чтобы лента не была пустой при ручной проверке.
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
