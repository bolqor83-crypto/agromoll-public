/**
 * Тесты RoleCoachMark (v0.6.2-C, ADR-029): подсказка первого входа в роль
 * показывается один раз, не блокирует (pointerEvents box-none), тап
 * скрывает и пишет флаг. Storage инжектится — контракт хранилища
 * покрыт first-run.test.ts.
 */
import { fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@agromoll/ui';
import { RoleCoachMark, coachHintsForRole } from '@/components/RoleCoachMark';

// Компонент импортирует lib/first-run → AsyncStorage: в jest нет native-модуля.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function makeStorage(seen: { value: boolean }) {
  return {
    isSeen: jest.fn().mockResolvedValue(seen.value),
    markSeen: jest.fn().mockResolvedValue(undefined),
  };
}

function renderMark(props: Partial<Parameters<typeof RoleCoachMark>[0]> = {}) {
  const { render } = require('@testing-library/react-native');
  const React = require('react');
  const storage = makeStorage({ value: false });
  const screen = render(
    React.createElement(
      SafeAreaProvider,
      null,
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(RoleCoachMark, { role: 'seller', storage, ...props }),
      ),
    ),
  );
  return { screen, storage };
}

describe('RoleCoachMark — подсказка первого входа (ADR-029)', () => {
  it('роль не видела подсказок — первая показывается', async () => {
    const { screen } = renderMark();
    await waitFor(() => {
      expect(screen.getByTestId('coach-mark-seller')).toBeTruthy();
    });
    expect(screen.getByText(/Нажмите \+ чтобы создать лот/)).toBeTruthy();
  });

  it('роль уже видела — не показывается', async () => {
    const { screen } = renderMark({
      storage: makeStorage({ value: true }),
    });
    // Даём эффектам отработать
    await waitFor(() => {
      expect(screen.queryByTestId('coach-mark-seller')).toBeNull();
    });
  });

  it('тап скрывает подсказку и пишет флаг', async () => {
    const { screen, storage } = renderMark();
    await waitFor(() => {
      expect(screen.getByTestId('coach-mark-seller')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('coach-mark-seller'));
    await waitFor(() => {
      expect(storage.markSeen).toHaveBeenCalledWith('seller');
      expect(screen.queryByTestId('coach-mark-seller')).toBeNull();
    });
  });

  it('каждая роль получает 2 конкретные подсказки', () => {
    expect(coachHintsForRole('buyer')).toHaveLength(2);
    expect(coachHintsForRole('seller')).toHaveLength(2);
    expect(coachHintsForRole('driver')).toHaveLength(2);
    // текст не пустой и без «воды» — конкретное место приложения
    for (const role of ['buyer', 'seller', 'driver']) {
      for (const hint of coachHintsForRole(role)) {
        expect(hint.text.length).toBeGreaterThan(10);
      }
    }
  });

  it('неизвестная роль — без подсказок (безопасный дефолт)', () => {
    expect(coachHintsForRole('admin')).toEqual([]);
  });
});
