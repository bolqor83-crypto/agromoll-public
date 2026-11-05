import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { HealthModule } from './health/health.module';
import { ListingsModule } from './listings/listings.module';
import { PrismaModule } from './prisma/prisma.module';

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
    ListingsModule,
    BookingsModule,
  ],
})
export class AppModule {}
