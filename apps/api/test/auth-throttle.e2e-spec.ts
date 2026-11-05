/**
 * E2E (v0.3.1): rate limit на POST /auth/refresh — 10 запросов в минуту
 * на IP. Отдельный файл с собственным приложением: счётчик throttler-а
 * изолирован от остальных e2e-спок, которые тоже дёргают refresh.
 *
 * Требует DATABASE_URL (мусорные refresh доходят до контроллера, но не
 * до БД) — запускается в CI с service-контейнерами.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Rate limit /auth/refresh (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await app.close();
  });

  it('11-й запрос в минуту с одного IP — 429', async () => {
    const LIMIT = 10;
    for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'garbage' });
      // первые 10 проходят throttler и получают 401 от сервиса (мусорный токен)
      expect(response.status).toBe(401);
    }

    // 11-й — отклонён throttler-ом
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'garbage' })
      .expect(429);
  });
});
