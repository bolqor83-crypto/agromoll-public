/**
 * Эндпоинты аутентификации (v0.3.0/v0.3.1, ADR-007/008).
 *
 *  POST /auth/request-code — код на телефон (1 запрос/мин на телефон).
 *  POST /auth/verify       — код → { accessToken, refreshToken, user }.
 *  POST /auth/refresh      — ротация refresh → новая пара токенов
 *                            (10 запросов/мин на IP — ротация лёгкая,
 *                            но перебор ограничиваем).
 *  POST /auth/logout       — отзыв семьи токенов, 204, идемпотентен.
 *
 * Ответы никогда не содержат коды или refresh-токены лишний раз.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  LogoutSchema,
  RefreshTokenSchema,
  RequestCodeSchema,
  VerifyCodeSchema,
} from '@agromoll/validation';
import type {
  LogoutInput,
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

  /** Шаг 2: проверить код, открыть сессию и получить токены с профилем. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodValidationPipe(VerifyCodeSchema)) body: VerifyCodeInput,
    @Req() request: Request,
  ) {
    return this.auth.verify(body.phone, body.code, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
  }

  /** Шаг 3: ротация refresh-токена → новая пара (ADR-008). 10/мин на IP. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Body(new ZodValidationPipe(RefreshTokenSchema)) body: RefreshTokenInput) {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * Выход: отзыв семьи refresh-токенов + блэклист access-jti.
   * 204 в том числе для мусорных/истёкших токенов — идемпотентность.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body(new ZodValidationPipe(LogoutSchema)) body: LogoutInput) {
    return this.auth.logout({ refreshToken: body.refreshToken, accessToken: body.accessToken });
  }
}
