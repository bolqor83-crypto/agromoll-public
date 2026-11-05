import { DEMO_ACCOUNTS } from '@agromoll/types';
import { demoUserId, demoUserName, useRoleStore } from './role';

describe('стор роли', () => {
  it('хранит выбранную роль', () => {
    expect(useRoleStore.getState().role).toBeNull();
    useRoleStore.getState().setRole('seller');
    expect(useRoleStore.getState().role).toBe('seller');
    useRoleStore.getState().setRole('buyer');
    expect(useRoleStore.getState().role).toBe('buyer');
  });

  it('demoUserId отдаёт фиксированный id демо-аккаунта (X-User-Id)', () => {
    expect(demoUserId('buyer')).toBe(DEMO_ACCOUNTS.buyer.id);
    expect(demoUserId('seller')).toBe(DEMO_ACCOUNTS.seller.id);
    expect(demoUserId('driver')).toBe(DEMO_ACCOUNTS.driver.id);
  });

  it('demoUserName — имя демо-аккаунта для подписей', () => {
    expect(demoUserName('seller')).toBe('ФХ «Донская долина»');
  });
});
