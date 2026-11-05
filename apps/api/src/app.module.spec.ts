/**
 * Регрессионный тест DI-графа AppModule (v0.3.0).
 *
 * Ловит класс багов «компонент не резолвится на компиляции модуля»,
 * который не видят unit-тесты с прямым конструированием и который
 * роняет ВСЕ e2e (а до этого — реальный запуск API). Конкретный случай:
 * `import type { Reflector }` стирал класс в рантайме → Nest видел
 * design:type = Function → «argument Function at index [1]» в
 * IdempotencyInterceptor, AppModule не компилировался вовсе.
 *
 * Без БД: PrismaService сам переживает недоступность (onModuleInit
 * ловит ошибку), SMS-хранилище без REDIS_URL — in-memory. Мы проверяем
 * только сборку DI-контейнера и наличие ключевых компонентов.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { JwtAuthGuard, RolesGuard } from './auth/auth.guards';
import { PrismaService } from './prisma/prisma.service';
import { CODE_STORE } from './auth/auth.constants';
import type { CodeStore } from './auth/code-store';

describe('AppModule DI-граф (unit, без БД)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('компилируется и инициализируется целиком', () => {
    expect(app).toBeDefined();
  });

  it('Reflector доступен в DI контексте AppModule (интерцептор упал именно на этом)', () => {
    // Именно этот компонент падал из-за type-only import Reflector.
    // APP_INTERCEPTOR-инстанс создаётся при инициализации (о чём говорит
    // сам факт app.init() выше); здесь дополнительно проверяем, что
    // Reflector доступен в контексте AppModule — то, чего не хватало.
    const reflector = app.select(AppModule).get(Reflector, { strict: false });
    expect(reflector).toBeInstanceOf(Reflector);
  });

  it('гварды аутентификации резолвятся', () => {
    expect(app.get(JwtAuthGuard, { strict: false })).toBeInstanceOf(JwtAuthGuard);
    expect(app.get(RolesGuard, { strict: false })).toBeInstanceOf(RolesGuard);
  });

  it('Prisma и хранилище кодов доступны', () => {
    // instanceof не подходит: Prisma-клиент — прокси с другой
    // идентичностью конструктора. Достаточно факта резолва.
    expect(app.get(PrismaService)).toBeDefined();
    expect(app.get<CodeStore>(CODE_STORE)).toBeDefined();
  });
});
