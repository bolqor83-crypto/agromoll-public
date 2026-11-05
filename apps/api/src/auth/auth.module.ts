import { Global, Module } from '@nestjs/common';
import { RolesGuard, UserGuard } from './user.guard';

/**
 * Модуль аутентификации — v0.2.0: заглушка X-User-Id.
 *
 * UserGuard читает заголовок и загружает пользователя из БД;
 * RolesGuard проверяет роли из @Roles(...). Оба применяются
 * на уровне контроллеров listings/bookings через APP_GUARD нельзя
 * (UserGuard не нужен на /health), поэтому подключаются явно.
 *
 * На следующем этапе здесь появится вход по телефону и JWT (ADR-001).
 */
@Global()
@Module({
  providers: [UserGuard, RolesGuard],
  exports: [UserGuard, RolesGuard],
})
export class AuthModule {}
