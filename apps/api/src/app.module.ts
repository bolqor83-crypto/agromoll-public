import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { AppealsModule } from './appeals/appeals.module';
import { BookingsModule } from './bookings/bookings.module';
import { DebtsModule } from './debts/debts.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { DisputesModule } from './disputes/disputes.module';
import { GeoModule } from './geo/geo.module';
import { HealthModule } from './health/health.module';
import { ListingsModule } from './listings/listings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReputationModule } from './reputation/reputation.module';
import { UsersModule } from './users/users.module';
import { WorkHoursModule } from './work-hours/work-hours.module';

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
    WorkHoursModule,
    ReputationModule,
    GeoModule,
    DeliveriesModule,
    // Арбитраж споров (v0.6.0-C, ADR-033).
    DisputesModule,
    // Апелляции на блокировки 289-ФЗ (v0.6.0-E, ADR-035).
    AppealsModule,
  ],
  providers: [
    // Идемпотентность POST-мутаций (X-Idempotency-Key, ADR-006):
    // применяется только к эндпоинтам с @Idempotent(...).
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
