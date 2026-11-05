import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
