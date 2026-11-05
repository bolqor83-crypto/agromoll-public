import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Дефолт совпадает с docker-compose.yml — чтобы api поднималось даже без .env. */
const DEFAULT_DATABASE_URL = 'postgresql://agromoll:agromoll@localhost:5432/agromoll?schema=public';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly nestLogger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: { db: { url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL } },
    });
  }

  /**
   * Подключаемся при старте, но не роняем API, если БД ещё не поднята:
   * на этапе каркаса healthcheck и приложение должны жить без БД.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.nestLogger.log('Prisma подключена к PostgreSQL');
    } catch (error) {
      this.nestLogger.warn(
        `PostgreSQL недоступна, API продолжает работу без БД: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
