import { Module } from '@nestjs/common';

/**
 * ЗАГЛУШКА модуля аутентификации.
 *
 * Этап 1 (каркас) — модуль пуст, реальная аутентификация не реализуется:
 * план — вход по телефону, роли buyer/seller/driver (см. roadmap в README и ADR-001).
 */
@Module({})
export class AuthModule {}
