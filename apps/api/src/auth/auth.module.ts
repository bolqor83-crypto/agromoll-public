import { Module } from '@nestjs/common';

/**
 * Заглушка модуля аутентификации.
 *
 * На этапе «фундамент» реального входа нет. На следующем этапе здесь появится
 * вход по номеру телефона и выдача роли (buyer / seller / driver).
 * Решения о стеке — в docs/adr/ADR-001.
 */
@Module({})
export class AuthModule {}
