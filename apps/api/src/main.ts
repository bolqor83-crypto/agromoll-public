import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Структурированные логи pino (см. ADR-001).
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Мобильный клиент (Expo web / dev-клиенты) ходит к API из браузера.
  // Аутентификация — JWT (v0.3.0), так что CORS может быть открыт для всех
  // источников: токены не зависят от origin и не читаются из cookies.
  app.enableCors({ origin: true });

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`API АгроМолл запущено: http://localhost:${port}`);
}

void bootstrap();
