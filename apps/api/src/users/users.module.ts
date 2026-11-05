import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';

/**
 * Модуль профиля: эндпоинты /users/me*.
 * Импортирует AuthModule ради JwtAuthGuard (глобальный модуль, но
 * зависимость объявляем явно для читаемости).
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UsersController],
})
export class UsersModule {}
