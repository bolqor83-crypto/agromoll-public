import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@agromoll/types';

@Controller('health')
export class HealthController {
  /** Простой liveness-check: без обращения к БД, чтобы API отвечал даже когда стек поднимается. */
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'agromoll-api',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
