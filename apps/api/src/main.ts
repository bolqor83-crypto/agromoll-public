import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { useJsonBodyLimit } from './app-body-parser';

async function bootstrap(): Promise<void> {
  // bodyParser: false — свой парсер с лимитом 4 МБ (ADR-033: доказательства
  // споров base64 ≤ 2 МБ не проходят дефолтные 100 КБ express).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  useJsonBodyLimit(app);

  // Структурированные логи pino (см. ADR-001).
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Мобильный клиент (Expo web / dev-клиенты) ходит к API из браузера.
  // Аутентификация — JWT (v0.3.0), так что CORS может быть открыт для всех
  // источников: токены не зависят от origin и не читаются из cookies.
  // v0.8.0-B (ADR-040): в проде список можно сузить через CORS_ORIGIN
  // (через запятую) — без переменной поведение прежнее (origin: true),
  // чтобы локальная разработка и e2e ничего не заметили.
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors(corsOrigins?.length ? { origin: corsOrigins } : { origin: true });

  // Railway/Render инжектят PORT автоматически (ADR-040); API_PORT —
  // приоритетный локальный override (не конфликтует с dev-стендами).
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`API АгроМолл запущено: http://localhost:${port}`);
}

void bootstrap();
