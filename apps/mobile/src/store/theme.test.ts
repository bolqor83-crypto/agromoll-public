/**
 * Тесты персиста темы (v0.6.1-B, ADR-024): выбор сохраняется сразу
 * и восстанавливается при следующем запуске (native — AsyncStorage).
 *
 * «Перезапуск приложения» эмулируем пере-импортом модуля стора
 * (jest.resetModules) — гидрация persist читает мок-хранилище.
 */

// Мок AsyncStorage: живая Map, как настоящий модуль.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        store.delete(k);
        return Promise.resolve();
      },
    },
  };
});

/** Выгружает микрозадачи (persist пишет/читает асинхронно). */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Свежий «запуск» приложения: новый экземпляр стора + гидрация. */
async function bootThemeStore(): Promise<typeof import('./theme')> {
  const mod = require('./theme');
  await flush();
  return mod;
}

function storage(): {
  getItem: (k: string) => Promise<string | null>;
  removeItem: (k: string) => Promise<void>;
} {
  return jest.requireMock('@react-native-async-storage/async-storage').default;
}

describe('theme-store persist (ADR-024)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('тумблер сохраняет выбор сразу (persist пишет на set)', async () => {
    const { useThemeStore } = await bootThemeStore();

    useThemeStore.getState().toggle('light'); // light → dark
    expect(useThemeStore.getState().setting).toBe('dark');
    await flush();

    // В хранилище появилась запись с выбранным значением
    const raw = await storage().getItem('agromoll.theme');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ state: { setting: 'dark' } });
  });

  it('сохранённый выбор восстанавливается при «перезапуске» приложения', async () => {
    // Первый «запуск»: выбираем тёмную тему
    const first = await bootThemeStore();
    first.useThemeStore.getState().setSetting('dark');
    await flush();
    expect(first.useThemeStore.getState().setting).toBe('dark');

    // Второй «запуск» (модуль пере-импортирован): выбор из хранилища
    const second = await bootThemeStore();
    expect(second.useThemeStore.getState().setting).toBe('dark');
  });

  it('без сохранённого выбора — системная схема (значение по умолчанию)', async () => {
    await storage().removeItem('agromoll.theme');

    const fresh = await bootThemeStore();
    expect(fresh.useThemeStore.getState().setting).toBe('system');
  });
});
