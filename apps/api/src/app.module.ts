import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { BookingsModule } from './bookings/bookings.module';
import { DebtsModule } from './debts/debts.module';
import { HealthModule } from './health/health.module';
import { ListingsModule } from './listings/listings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Cron гашения просроченных броней (BookingTtlCron в BookingsModule).
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // В разработке — человекочитаемый вывод, в проде — чистый JSON.
        transport: isProduction
          ? undefined
          : {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
        // healthcheck не должен шуметь в логах
        autoLogging: { ignore: (req) => String(req.url ?? '').startsWith('/health') },
      },
    }),
    HealthModule,
    AuthModule,
    PrismaModule,
    UsersModule,
    ListingsModule,
    BookingsModule,
    DebtsModule,
    NotificationsModule,
  ],
  providers: [
    // Идемпотентность POST-мутаций (X-Idempotency-Key, ADR-006):
    // применяется только к эндпоинтам с @Idempotent(...).
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
