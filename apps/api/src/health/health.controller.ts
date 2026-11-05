import { Controller, Get } from '@nestjs/common';

/**
 * Healthcheck: живой процесс API.
 * Бизнес-логики нет — это фундаментальный индикатор для CI, docker и мониторинга.
 *
 * Формат согласован с @agromoll/types (HealthCheckResponse). Подключение пакета
 * типов в api — следующий этап, вместе с dist-сборкой пакетов (см. ADR-003).
 */
interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
}

const SERVICE_NAME = 'agromoll-api';
const SERVICE_VERSION = '0.1.0';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    };
  }
}
