import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './auth.guards';
import { CodeStoreShutdown, codeStoreProvider } from './code-store';
import { PhoneThrottlerGuard } from './phone-throttler.guard';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Модуль аутентификации — v0.3.0: телефон + SMS-код → JWT (ADR-007).
 *
 * JwtAuthGuard проверяет Authorization: Bearer и перечитывает пользователя
 * из БД (свежая роль); RolesGuard проверяет @Roles(...). Guard'ы применяются
 * явно на контроллерах listings/bookings/users — /health и /auth/* публичные.
 *
 * SMS-коды живут в Redis (REDIS_URL), при его отсутствии — in-memory
 * fallback для локальной разработки (см. code-store.ts).
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    // JwtService: секрет/срок подставляются при подписи в AuthService,
    // здесь — пустая конфигурация (у access и refresh секреты разные).
    JwtModule.register({}),
    // Rate limit только на /auth/request-code (PhoneThrottlerGuard),
    // остальным эндпоинтам лимиты не нужны.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, PhoneThrottlerGuard, codeStoreProvider, CodeStoreShutdown],
  exports: [JwtAuthGuard, RolesGuard, AuthService, JwtModule],
})
export class AuthModule {}
