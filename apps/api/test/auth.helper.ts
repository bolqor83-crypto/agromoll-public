/**
 * Помощник e2e-тестов: вход по телефону + JWT (v0.3.0).
 *
 * Полный флоу через HTTP: request-code → код из CodeStore (тот же, что
 * у приложения — Redis или in-memory) → verify → PATCH /users/me/role.
 * Телефоны генерируются уникальными, чтобы не упираться в rate limit
 * (1 запрос/мин на телефон).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { UserRole } from '@agromoll/types';
import { CODE_STORE } from '../src/auth/auth.constants';
import type { CodeStore } from '../src/auth/code-store';

export interface TestUser {
  id: string;
  phone: string;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
}

/** Счётчик уникальных телефонов: старт со случайного смещения, чтобы
 * разные прогоны тестов не пересекались на одной «минуте» rate limit. */
let phoneCounter = Math.floor(Math.random() * 900_000);

/**
 * Уникальный российский номер (несуществующий диапазон +7999).
 * Формат строго E.164: +7 и 10 цифр — «999» + 7 цифр счётчика.
 */
export function uniquePhone(): string {
  phoneCounter += 1;
  const tail = String(phoneCounter).padStart(7, '0').slice(-7);
  return `+7999${tail}`;
}

/** Authorization-заголовок для supertest. */
export function authHeader(user: TestUser): Record<string, string> {
  return { Authorization: `Bearer ${user.accessToken}` };
}

/** Регистрация + вход + установка роли. */
export async function registerAndLogin(
  app: INestApplication,
  role: UserRole,
  phone = uniquePhone(),
): Promise<TestUser> {
  await request(app.getHttpServer()).post('/auth/request-code').send({ phone }).expect(200);

  // Код достаём из того же хранилища, в которое его положил AuthService:
  // в CI это Redis (REDIS_URL), локально — in-memory.
  const store = app.get<CodeStore>(CODE_STORE);
  const code = await store.get(phone);
  if (!code) {
    throw new Error('Код не найден в хранилище — request-code не сработал');
  }

  const verify = await request(app.getHttpServer())
    .post('/auth/verify')
    .send({ phone, code })
    .expect(200);

  const accessToken: string = verify.body.accessToken;
  const refreshToken: string = verify.body.refreshToken;

  // Устанавливаем роль через публичный эндпоинт (заодно он тестируется).
  if (role !== 'buyer') {
    const patched = await request(app.getHttpServer())
      .patch('/users/me/role')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role })
      .expect(200);
    expect(patched.body.role).toBe(role);
  }

  return { id: verify.body.user.id, phone, role, accessToken, refreshToken };
}
