import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('возвращает статус ok', () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('agromoll-api');
    expect(typeof result.uptime).toBe('number');
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
