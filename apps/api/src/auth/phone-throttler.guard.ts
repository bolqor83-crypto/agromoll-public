/**
 * Rate limit на /auth/request-code: не чаще 1 запроса в минуту НА ТЕЛЕФОН.
 *
 * Базовый ThrottlerGuard считает по IP — на рынке все сидят за одним Wi-Fi,
 * поэтому трекер переопределён на нормализованный телефон из тела запроса
 * (fallback — IP). Защищает и от SMS-флуда, и от перебора кодов.
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { normalizePhone } from '@agromoll/types';

type TrackerRequest = Record<string, unknown> & {
  body?: { phone?: unknown };
  ip?: string;
};

@Injectable()
export class PhoneThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: TrackerRequest): Promise<string> {
    if (typeof req.body?.phone === 'string') {
      const normalized = normalizePhone(req.body.phone);
      if (normalized) {
        return Promise.resolve(`phone:${normalized}`);
      }
    }
    return Promise.resolve(`ip:${req.ip ?? 'unknown'}`);
  }
}
