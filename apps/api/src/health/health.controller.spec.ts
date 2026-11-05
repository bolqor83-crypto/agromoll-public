import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('возвращает status ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('представляется как agromoll-api', () => {
    const result = controller.check();
    expect(result.service).toBe('agromoll-api');
  });

  it('заполняет timestamp и uptimeSec', () => {
    const result = controller.check();
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(result.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
