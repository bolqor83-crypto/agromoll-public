/**
 * Сервис аутентификации: телефон + SMS-код → JWT (v0.3.0, ADR-007).
 *
 * Флоу:
 *  1. requestCode(phone) — находит/создаёт пользователя, генерирует код,
 *     сохраняет в CodeStore (Redis, TTL 5 минут). В dev код фиксированный
 *     «0000» и логируется; в production интеграция с SMS-провайдером
 *     появится позже (пока код не отправляется — MVP).
 *  2. verify(phone, code) — сверяет код, помечает phoneVerified,
 *     выдаёт пару токенов.
 *  3. refresh(refreshToken) — проверяет подпись/срок refresh-токена,
 *     выдаёт новый access.
 *
 * Логи: только маскированный телефон (maskPhone), без кода и токенов.
 */
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { randomInt } from 'node:crypto';
import type { User, UserRole } from '@prisma/client';
import { maskPhone } from '@agromoll/types';
import type { AuthResponseDto, RefreshResponseDto, UserDto } from '@agromoll/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CODE_STORE,
  CODE_TTL_SECONDS,
  DEFAULT_ACCESS_TTL,
  DEFAULT_REFRESH_TTL,
  DEV_ACCESS_SECRET,
  DEV_CODE,
  DEV_REFRESH_SECRET,
} from './auth.constants';
import type { CodeStore } from './code-store';
import type { JwtPayload } from './auth.types';

/** Запись пользователя для request.user (поля из БД, не из токена). */
export interface AuthenticatedRecord {
  id: string;
  role: UserRole;
  displayName: string;
  phone: string | null;
}

/** Имя по умолчанию для нового пользователя: «Участник +7***1234». */
function defaultDisplayName(phone: string): string {
  return `Участник ${maskPhone(phone)}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: JwtSignOptions['expiresIn'];
  private readonly refreshTtl: JwtSignOptions['expiresIn'];
  private readonly isProduction: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(CODE_STORE) private readonly codes: CodeStore,
  ) {
    this.isProduction = process.env.NODE_ENV === 'production';
    const access = process.env.JWT_ACCESS_SECRET;
    const refresh = process.env.JWT_REFRESH_SECRET;
    if (this.isProduction && (!access || !refresh)) {
      // Фейлим старт приложения, а не первый запрос: секреты — обязательное
      // условие эксплуатации (см. ADR-007).
      throw new Error('В production обязательны JWT_ACCESS_SECRET и JWT_REFRESH_SECRET');
    }
    if (!access || !refresh) {
      this.logger.warn('JWT-секреты не заданы — используются dev-заглушки. Только для разработки!');
    }
    this.accessSecret = access ?? DEV_ACCESS_SECRET;
    this.refreshSecret = refresh ?? DEV_REFRESH_SECRET;
    // Строки вида «15m»/«30d»: тип StringValue из jsonwebtoken, потому каст
    // (env всегда строка, валидность формата гарантируем тестом конфигурации).
    this.accessTtl = (process.env.JWT_ACCESS_TTL ?? DEFAULT_ACCESS_TTL) as JwtSignOptions['expiresIn'];
    this.refreshTtl = (process.env.JWT_REFRESH_TTL ?? DEFAULT_REFRESH_TTL) as JwtSignOptions['expiresIn'];
  }

  /** Шаг 1: выдать код на телефон. */
  async requestCode(phone: string): Promise<{ expiresInSec: number }> {
    await this.findOrCreateUser(phone);

    const code = this.isProduction ? this.generateCode() : DEV_CODE;
    await this.codes.save(phone, code);

    // Структурированный лог: телефон маскирован. В dev код печатаем
    // (заглушка «0000» и так публична в UI), в prod — никогда.
    this.logger.log(
      `SMS-код выдан: phone=${maskPhone(phone)} ttl=${CODE_TTL_SECONDS}s code=${
        this.isProduction ? '<не-логируется>' : code
      }`,
    );

    return { expiresInSec: CODE_TTL_SECONDS };
  }

  /** Шаг 2: проверить код, выдать токены и профиль. */
  async verify(phone: string, code: string): Promise<AuthResponseDto> {
    const stored = await this.codes.get(phone);
    if (!stored) {
      throw new UnauthorizedException('Код не найден или истёк — запросите новый');
    }
    if (stored !== code) {
      throw new UnauthorizedException('Неверный код');
    }
    // Код одноразовый: сразу удаляем, повторно воспользоваться нельзя.
    await this.codes.delete(phone);

    const user = await this.prisma.user.update({
      where: { phone },
      data: { phoneVerified: true },
    });

    const tokens = this.issueTokens(user);
    this.logger.log(`Вход выполнен: user=${user.id} phone=${maskPhone(phone)}`);
    return { ...tokens, user: toUserDto(user) };
  }

  /** Шаг 3: обновить access-токен по refresh-токену. */
  async refresh(refreshToken: string): Promise<RefreshResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh-токен недействителен или истёк');
    }

    // Пользователь мог быть удалён — перечитываем из БД.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const accessToken = this.signAccess(user);
    this.logger.log(`Access-токен обновлён: user=${user.id}`);
    return { accessToken };
  }

  /** Свежий профиль по id — используется JwtAuthGuard (роль из БД, не из токена). */
  async getAuthenticatedUser(id: string): Promise<AuthenticatedRecord | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, displayName: true, phone: true },
    });
  }

  private findOrCreateUser(phone: string): Promise<User> {
    return this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        displayName: defaultDisplayName(phone),
        // Новые пользователи создаются с ролью buyer по умолчанию;
        // сменить её можно на экране выбора роли (PATCH /users/me/role).
        role: 'buyer',
      },
    });
  }

  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private issueTokens(user: User): { accessToken: string; refreshToken: string } {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return {
      accessToken: this.signAccess(user),
      refreshToken: this.jwt.sign(payload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtl,
      }),
    };
  }

  private signAccess(user: User): string {
    return this.jwt.sign({ sub: user.id, role: user.role } satisfies JwtPayload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl,
    });
  }
}

/** Prisma-модель → UserDto (даты — ISO, лишнего не отдаём). */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    createdAt: user.createdAt.toISOString(),
  };
}
