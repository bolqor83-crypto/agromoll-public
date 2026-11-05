import { useThemeStore } from './theme';

describe('theme store', () => {
  it('по умолчанию следует системной теме', () => {
    expect(useThemeStore.getState().setting).toBe('system');
  });

  it('setSetting меняет настройку', () => {
    useThemeStore.getState().setSetting('dark');
    expect(useThemeStore.getState().setting).toBe('dark');
    useThemeStore.getState().setSetting('system');
  });

  it('toggle переключает на противоположный явный режим', () => {
    useThemeStore.getState().toggle('light');
    expect(useThemeStore.getState().setting).toBe('dark');

    useThemeStore.getState().toggle('dark');
    expect(useThemeStore.getState().setting).toBe('light');

    useThemeStore.getState().setSetting('system');
  });
});
