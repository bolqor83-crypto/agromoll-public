import { logger } from './logger';

describe('logger', () => {
  it('info пишет сообщение с scope и данными', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test', 'сообщение', { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('[agromoll:test]');
    expect(spy.mock.calls[0][0]).toContain('сообщение');
    expect(spy.mock.calls[0][0]).toContain('"a":1');
    spy.mockRestore();
  });

  it('без данных не добавляет JSON-хвост', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test', 'чистое сообщение');
    expect(spy.mock.calls[0][0]).not.toContain('{');
    spy.mockRestore();
  });

  it('error уходит в console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('api', 'ошибка');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
