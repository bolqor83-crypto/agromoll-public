/**
 * Эндпоинты аутентификации (v0.3.0, ADR-007).
 *
 *  POST /auth/request-code — код на телефон (1 запрос/мин на телефон).
 *  POST /auth/verify       — код → { accessToken, refreshToken, user }.
 *  POST /auth/refresh      — refreshToken → { accessToken }.
 *
 * Все три эндпоинта публичные (без JwtAuthGuard). Ответы никогда не
 * содержат коды или refresh-токены лишний раз.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  RefreshTokenSchema,
  RequestCodeSchema,
  VerifyCodeSchema,
} from '@agromoll/validation';
import type {
  RefreshTokenInput,
  RequestCodeInput,
  VerifyCodeInput,
} from '@agromoll/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { PhoneThrottlerGuard } from './phone-throttler.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Шаг 1: запросить код. Rate limit — 1 запрос в минуту на телефон:
   * защита от SMS-флуда и подбора (429 при повторе).
   */
  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PhoneThrottlerGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  requestCode(@Body(new ZodValidationPipe(RequestCodeSchema)) body: RequestCodeInput) {
    return this.auth.requestCode(body.phone);
  }

  /** Шаг 2: проверить код и получить токены с профилем. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body(new ZodValidationPipe(VerifyCodeSchema)) body: VerifyCodeInput) {
    return this.auth.verify(body.phone, body.code);
  }

  /** Шаг 3: обновить access-токен. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(RefreshTokenSchema)) body: RefreshTokenInput) {
    return this.auth.refresh(body.refreshToken);
  }
}
