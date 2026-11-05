import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma-клиент как глобальный провайдер.
 *
 * Соединение открывается лениво — при первом запросе: healthcheck и тесты
 * работают без поднятой БД, что позволяет CI оставаться быстрым и зелёным.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
