/**
 * Сервис аутентификации: телефон + SMS-код → JWT (v0.3.0, ADR-007;
 * v0.3.1 — ротация refresh-токенов с отзывом, ADR-008).
 *
 * Флоу:
 *  1. requestCode(phone) — находит/создаёт пользователя, генерирует код,
 *     сохраняет в CodeStore (Redis, TTL 5 минут). В dev код фиксированный
 *     «0000» и логируется; в production интеграция с SMS-провайдером
 *     появится позже (пока код не отправляется — MVP).
 *  2. verify(phone, code) — сверяет код, помечает phoneVerified,
 *     открывает «семью» сессии (familyId + jti в Redis и аудит-строку
 *     Session в Postgres), выдаёт пару токенов.
 *  3. refresh(refreshToken) — ротация: старый jti → used, новый jti →
 *     active, новая пара токенов. Повторное предъявление старого jti —
 *     признак кражи: вся семья отзывается, 401 TOKEN_REUSE_DETECTED.
 *  4. logout(refreshToken) — отзыв семьи + блэклист jti access-токена
 *     (TTL = остаток его жизни). Идемпотентен.
 *
 * Fail-closed: если Redis (session store) недоступен — refresh и доступ
 * по access-токену отклоняются (401), вход не выдаёт неотзываемые токены.
 * Логи: только маскированный телефон (maskPhone), без кодов и токенов.
 */
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { randomInt, randomUUID } from 'node:crypto';
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
  SESSION_STORE,
  TOKEN_REUSE_DETECTED,
} from './auth.constants';
import type { CodeStore } from './code-store';
import type { SessionStore } from './session-store';
import type { JwtPayload, LoginMeta } from './auth.types';

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

/** Ошибка в одну строку для логов — без стека и мусора. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
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
    this.accessTtl = (process.env.JWT_ACCESS_TTL ??
      DEFAULT_ACCESS_TTL) as JwtSignOptions['expiresIn'];
    this.refreshTtl = (process.env.JWT_REFRESH_TTL ??
      DEFAULT_REFRESH_TTL) as JwtSignOptions['expiresIn'];
  }

  /** Шаг 1: выдать код на телефон. */
  async requestCode(phone: string): Promise<{ expiresInSec: number }> {
    await this.findOrCreateUser(phone);

    // v0.8.0-C: AUTH_DEMO_LOGIN=true — публичное демо (ADR-040):
    // вход по фиксированному «0000» и в production, чтобы ссылку можно
    // было показать без SMS-провайдера. Явный opt-in, по умолчанию OFF —
    // боевой запуск просто не выставляет переменную.
    const demoLogin = process.env.AUTH_DEMO_LOGIN === 'true';
    if (demoLogin && this.isProduction) {
      this.logger.warn(
        'ДЕМО-РЕЖИМ ВХОДА (AUTH_DEMO_LOGIN=true): любой телефон входит по коду «0000». Отключить перед боевым запуском!',
      );
    }
    const code = this.isProduction && !demoLogin ? this.generateCode() : DEV_CODE;
    await this.codes.save(phone, code);

    // Структурированный лог: телефон маскирован. В dev код печатаем
    // (заглушка «0000» и так публична в UI), в prod — никогда
    // (кроме демо-режима — там код и так «0000»).
    this.logger.log(
      `SMS-код выдан: phone=${maskPhone(phone)} ttl=${CODE_TTL_SECONDS}s code=${
        this.isProduction && !demoLogin ? '<не-логируется>' : code
      }`,
    );

    return { expiresInSec: CODE_TTL_SECONDS };
  }

  /** Шаг 2: проверить код, открыть сессию, выдать токены и профиль. */
  async verify(phone: string, code: string, meta: LoginMeta = {}): Promise<AuthResponseDto> {
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

    // v0.3.1: каждый вход открывает новую «семью» токенов (ADR-008) —
    // несколько устройств = несколько независимых семей.
    const familyId = randomUUID();
    const refreshJti = randomUUID();
    const tokens = this.issueTokens(user, { familyId, refreshJti });

    // Сначала аудит-строка в Postgres, затем сессия в Redis. Если Redis
    // недоступен — вход падает (fail-closed): не выдаём неотзываемые токены.
    await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId,
        currentJti: refreshJti,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      },
    });
    try {
      await this.sessions.createSession({ familyId, userId: user.id, jti: refreshJti });
    } catch (error) {
      this.logger.error(
        `Session store недоступен (degraded): вход отклонён (fail-closed): ${describeError(error)}`,
      );
      throw new ServiceUnavailableException('Сервис входа временно недоступен — попробуйте позже');
    }

    this.logger.log(`Вход выполнен: user=${user.id} phone=${maskPhone(phone)} family=${familyId}`);
    return { ...tokens, user: toUserDto(user) };
  }

  /**
   * Шаг 3: ротация refresh-токена (v0.3.1, ADR-008).
   *
   * Старый jti атомарно помечается used, выдаётся новая пара токенов.
   * Повторное предъявление старого jti — признак кражи: вся семья
   * отзывается, 401 с кодом TOKEN_REUSE_DETECTED.
   */
  async refresh(refreshToken: string): Promise<RefreshResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh-токен недействителен или истёк');
    }

    const { jti, familyId } = payload;
    if (!jti || !familyId) {
      // Токен формата v0.3.0 (без jti/familyId) — ротация невозможна.
      throw new UnauthorizedException('Refresh-токен недействителен или истёк');
    }

    // Пользователь мог быть удалён — перечитываем из БД.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    let status: Awaited<ReturnType<SessionStore['consumeRefreshJti']>>;
    try {
      status = await this.sessions.consumeRefreshJti(jti);
    } catch (error) {
      this.logger.warn(
        `Session store недоступен (degraded): refresh отклонён (fail-closed): ${describeError(error)}`,
      );
      throw new UnauthorizedException('Сервис аутентификации временно недоступен');
    }

    if (status === null || status === 'revoked') {
      // Ключа нет (истёк TTL) либо семья отозвана (logout / смена роли).
      throw new UnauthorizedException('Сессия завершена');
    }
    if (status === 'used') {
      // REUSE DETECTED: старый токен предъявлен повторно — признак кражи.
      await this.revokeFamilyOnReuse(familyId, payload.sub);
      throw new UnauthorizedException({
        code: TOKEN_REUSE_DETECTED,
        message: 'Сессия завершена. Войдите снова',
      });
    }

    // status === 'active': ротация.
    const newJti = randomUUID();
    try {
      await this.sessions.rotateRefreshJti({ familyId, userId: user.id, newJti });
    } catch (error) {
      this.logger.warn(
        `Session store недоступен (degraded): refresh отклонён (fail-closed): ${describeError(error)}`,
      );
      throw new UnauthorizedException('Сервис аутентификации временно недоступен');
    }

    // Аудит в Postgres: currentJti + история used. Redis уже ротирован,
    // поэтому сбой аудита не должен убивать живую сессию — логируем.
    await this.prisma.session
      .update({
        where: { familyId },
        data: { currentJti: newJti, usedJtis: { push: jti } },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Аудит ротации не записан (сессия жива): family=${familyId}: ${describeError(error)}`,
        );
      });

    const tokens = this.issueTokens(user, { familyId, refreshJti: newJti });
    this.logger.log(`Refresh-токен ротирован: user=${user.id} family=${familyId}`);
    return tokens;
  }

  /**
   * Выход (v0.3.1): отозвать семью refresh-токенов + заблэклистить jti
   * access-токена. Идемпотентен: мусорный/истёкший токен — не ошибка,
   * «уже вышли». Ошибка store — 503 (fail-closed: не подтверждаем
   * отзыв, которого не было).
   */
  async logout(input: { refreshToken: string; accessToken?: string }): Promise<void> {
    // Блэклист access-jti — даже если refresh уже мёртв: доступ отзываем
    // всегда, когда access-токен распарсился и ещё жив.
    if (input.accessToken) {
      await this.blacklistAccessToken(input.accessToken);
    }

    let payload: JwtPayload | null = null;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(input.refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      // Истёк/мусор/старый формат — отзывать нечего: идемпотентный 204.
      return;
    }
    if (!payload.jti || !payload.familyId) {
      return;
    }

    try {
      await this.sessions.revokeFamily(payload.familyId);
    } catch (error) {
      this.logger.error(
        `Session store недоступен (degraded): logout не выполнен: ${describeError(error)}`,
      );
      throw new ServiceUnavailableException('Не удалось завершить сессию — попробуйте ещё раз');
    }

    await this.prisma.session
      .updateMany({
        where: { familyId: payload.familyId },
        data: { revokedAt: new Date() },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Аудит logout не записан (семья отозвана в store): family=${payload.familyId}: ${describeError(error)}`,
        );
      });

    this.logger.log(`Logout: семья отозвана: user=${payload.sub} family=${payload.familyId}`);
  }

  /**
   * Отзыв чужих сессий при смене роли (защита от privilege escalation):
   * все семьи пользователя, кроме текущей. Сначала отзыв — потом смена
   * роли: если отзыв не удался, роль не меняется (fail-closed).
   */
  async revokeOtherSessions(userId: string, keepFamilyId: string | undefined): Promise<number> {
    const others = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}),
      },
      select: { familyId: true },
    });
    if (others.length === 0) {
      return 0;
    }
    const familyIds = others.map((session) => session.familyId);
    try {
      await this.sessions.revokeFamilies(familyIds);
    } catch (error) {
      this.logger.error(
        `Session store недоступен (degraded): смена роли отклонена (fail-closed): ${describeError(error)}`,
      );
      throw new ServiceUnavailableException(
        'Не удалось завершить другие сессии — попробуйте ещё раз',
      );
    }
    await this.prisma.session.updateMany({
      where: { familyId: { in: familyIds } },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`Смена роли: отозваны другие сессии: user=${userId} count=${familyIds.length}`);
    return familyIds.length;
  }

  /**
   * Проверка access-токена по блэклисту (вызывается JwtAuthGuard).
   * jti нет (токен v0.3.0) — пропускаем: блэклистить нечего.
   * Store недоступен — fail-closed: true (токен отклоняется).
   */
  async isAccessTokenRevoked(jti: string | undefined): Promise<boolean> {
    if (!jti) {
      return false;
    }
    try {
      return await this.sessions.isAccessJtiBlacklisted(jti);
    } catch (error) {
      this.logger.warn(
        `Session store недоступен (degraded): access-токен отклонён (fail-closed): ${describeError(error)}`,
      );
      return true;
    }
  }

  /** Свежий профиль по id — используется JwtAuthGuard (роль из БД, не из токена). */
  async getAuthenticatedUser(id: string): Promise<AuthenticatedRecord | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, displayName: true, phone: true },
    });
  }

  /** Семья отозвана из-за повторного использования — security-событие. */
  private async revokeFamilyOnReuse(familyId: string, userId: string): Promise<void> {
    this.logger.warn(
      `SECURITY: повторное использование refresh-токена — семья отозвана: user=${userId} family=${familyId}`,
    );
    try {
      await this.sessions.revokeFamily(familyId);
    } catch (error) {
      this.logger.error(
        `ВНИМАНИЕ: не удалось отозвать семью в store (degraded): family=${familyId}: ${describeError(error)}`,
      );
    }
    await this.prisma.session
      .updateMany({ where: { familyId }, data: { revokedAt: new Date() } })
      .catch((error: unknown) => {
        this.logger.warn(`Аудит отзыва не записан: family=${familyId}: ${describeError(error)}`);
      });
  }

  /** Блэклист jti access-токена (TTL = остаток жизни). Лучшая попытка. */
  private async blacklistAccessToken(token: string): Promise<void> {
    try {
      const decoded = this.jwt.decode(token);
      if (!decoded || typeof decoded === 'string') {
        return;
      }
      const { jti, exp } = decoded as { jti?: string; exp?: number };
      if (!jti || !exp) {
        return; // токен v0.3.0 без jti — блэклистить нечего
      }
      const remainingSec = exp - Math.floor(Date.now() / 1000);
      if (remainingSec <= 0) {
        return;
      }
      await this.sessions.blacklistAccessJti(jti, remainingSec);
    } catch (error) {
      this.logger.warn(`Не удалось заблэклистить access-токен: ${describeError(error)}`);
    }
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

  private issueTokens(
    user: User,
    session: { familyId: string; refreshJti: string },
  ): { accessToken: string; refreshToken: string } {
    const payload: JwtPayload = { sub: user.id, role: user.role, familyId: session.familyId };
    return {
      accessToken: this.signAccess(user, session.familyId),
      refreshToken: this.jwt.sign(payload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtl,
        jwtid: session.refreshJti,
      }),
    };
  }

  private signAccess(user: User, familyId: string): string {
    return this.jwt.sign({ sub: user.id, role: user.role, familyId } satisfies JwtPayload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl,
      jwtid: randomUUID(),
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
    totalConfirmations: user.totalConfirmations,
    totalDisputes: user.totalDisputes,
    createdAt: user.createdAt.toISOString(),
  };
}
