import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './auth.guards';
import { CodeStoreShutdown, codeStoreProvider } from './code-store';
import { SessionStoreShutdown, sessionStoreProvider } from './session-store';
import { PhoneThrottlerGuard } from './phone-throttler.guard';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Модуль аутентификации — v0.3.0: телефон + SMS-код → JWT (ADR-007);
 * v0.3.1: ротация refresh-токенов с отзывом (ADR-008).
 *
 * JwtAuthGuard проверяет Authorization: Bearer, сверяет jti с блэклистом
 * и перечитывает пользователя из БД (свежая роль); RolesGuard проверяет
 * @Roles(...). Guard'ы применяются явно на контроллерах
 * listings/bookings/users — /health и /auth/* публичные.
 *
 * SMS-коды и сессии живут в Redis (REDIS_URL), при его отсутствии —
 * in-memory fallback для локальной разработки (code-store.ts,
 * session-store.ts). В production Redis обязателен.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    // JwtService: секрет/срок подставляются при подписи в AuthService,
    // здесь — пустая конфигурация (у access и refresh секреты разные).
    JwtModule.register({}),
    // Базовые лимиты: request-code переопределяется на «1/мин на телефон»
    // через PhoneThrottlerGuard, refresh — на «10/мин на IP» в контроллере.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    PhoneThrottlerGuard,
    codeStoreProvider,
    CodeStoreShutdown,
    sessionStoreProvider,
    SessionStoreShutdown,
  ],
  exports: [JwtAuthGuard, RolesGuard, AuthService, JwtModule],
})
export class AuthModule {}
