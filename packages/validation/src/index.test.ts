import { describe, expect, it } from 'vitest';
import { UserRoleSchema, apiEnvSchema } from './index';

describe('@agromoll/validation', () => {
  it('UserRoleSchema принимает все роли рынка', () => {
    for (const role of ['buyer', 'seller', 'driver'] as const) {
      expect(UserRoleSchema.parse(role)).toBe(role);
    }
  });

  it('UserRoleSchema отклоняет неизвестную роль', () => {
    expect(UserRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('apiEnvSchema подставляет дефолты и конвертирует порт', () => {
    const env = apiEnvSchema.parse({
      API_PORT: '4000',
      DATABASE_URL: 'postgresql://localhost:5432/agromoll',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('apiEnvSchema требует DATABASE_URL', () => {
    expect(apiEnvSchema.safeParse({}).success).toBe(false);
  });
});
