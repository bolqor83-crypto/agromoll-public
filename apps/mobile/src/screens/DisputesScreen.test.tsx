/**
 * Тесты рендера «Споров» (v0.6.0-C ADR-033 → v0.7.0-B ADR-036):
 * статусная машина без фейков — ошибка сети → ErrorState с повтором;
 * пусто → честное пустое состояние; данные → карточки кейсов;
 * детали кейса → превью доказательств по ссылкам (S3/data:-URL).
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@agromoll/ui';

jest.mock('expo-router', () => require('@/test/screen-mocks').createRouterMock());
jest.mock('@/lib/api', () => require('@/test/screen-mocks').createApiModuleMock());
jest.mock('@/store/auth', () => require('@/test/screen-mocks').createAuthStoreMock());
jest.mock('@/store/theme', () => require('@/test/screen-mocks').createThemeStoreMock());
jest.mock('@/lib/media/photo', () => ({
  pickAndCompressPhoto: jest.fn(),
  FALLBACK_MAX_BYTES: 500 * 1024,
}));

// eslint-disable-next-line import/first -- моки объявляются до экрана
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { pickAndCompressPhoto } from '@/lib/media/photo';
// eslint-disable-next-line import/first
import DisputesScreen from './DisputesScreen';

const mockApi = api as unknown as {
  myDisputes: jest.Mock;
  dispute: jest.Mock;
  disputeEvidence: jest.Mock;
};
const mockPick = pickAndCompressPhoto as jest.Mock;

function renderScreen() {
  return render(
    <ThemeProvider>
      <DisputesScreen />
    </ThemeProvider>,
  );
}

/** Валидный кейс для zod-валидации ответа. */
function makeDispute() {
  const party = (id: string, role: string) => ({
    id,
    displayName: `Участник ${id}`,
    role,
  });
  return {
    id: 'd-1',
    type: 'booking' as const,
    referenceId: 'b-1',
    subject: 'Бронь: Помидоры розовые',
    status: 'open' as const,
    firstParty: party('u-buyer', 'buyer'),
    secondParty: party('u-seller', 'seller'),
    openedBy: party('u-buyer', 'buyer'),
    openedAt: new Date('2026-11-07T08:00:00Z').toISOString(),
    assignedTo: null,
    assignedAt: null,
    resolution: null,
    resolvedAt: null,
    notes: null,
    messagesCount: 2,
    evidenceCount: 1,
  };
}

/** Детали кейса (DisputeDetailDto) с одним сообщением и одним фото. */
function makeDisputeDetail() {
  const party = (id: string, role: string) => ({
    id,
    displayName: `Участник ${id}`,
    role,
  });
  return {
    ...makeDispute(),
    messages: [
      {
        id: 'm-1',
        author: party('u-buyer', 'buyer'),
        body: 'Ящики разбиты',
        isInternal: false,
        createdAt: new Date('2026-11-07T08:05:00Z').toISOString(),
      },
    ],
    evidence: [
      {
        id: 'ev-1',
        fileName: 'yashiki.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        uploadedBy: party('u-buyer', 'buyer'),
        createdAt: new Date('2026-11-07T08:06:00Z').toISOString(),
      },
    ],
  };
}

describe('«Споры» (ADR-033): статусная машина без фейков', () => {
  beforeEach(() => {
    mockApi.myDisputes.mockReset();
    mockApi.dispute.mockReset();
    mockApi.disputeEvidence.mockReset();
    mockPick.mockReset();
  });

  it('сеть упала → ErrorState с «Повторить»', async () => {
    mockApi.myDisputes.mockRejectedValue({
      message: 'Сеть недоступна',
      code: 'NETWORK',
      status: undefined,
      body: undefined,
      hint: undefined,
    });
    const { queryByText, findByText } = renderScreen();
    expect(await findByText('Нет связи с сервером')).toBeTruthy();
    expect(queryByText('Споров нет')).toBeNull();
  });

  it('пустой список → честное пустое состояние', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [] });
    const { findByText } = renderScreen();
    expect(await findByText('Споров нет')).toBeTruthy();
  });

  it('кейсы → карточки со статусами и сторонами', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [makeDispute()] });
    const { findByText } = renderScreen();
    expect(await findByText('Бронь: Помидоры розовые')).toBeTruthy();
    expect(await findByText('Открыт')).toBeTruthy();
  });

  it('детали кейса: превью доказательства по ссылке из GET /evidence', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [makeDispute()] });
    mockApi.dispute.mockResolvedValue(makeDisputeDetail());
    mockApi.disputeEvidence.mockResolvedValue({
      items: [
        {
          id: 'ev-1',
          fileName: 'yashiki.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
          uploadedBy: { id: 'u-buyer', displayName: 'Участник u-buyer', role: 'buyer' },
          createdAt: new Date('2026-11-07T08:06:00Z').toISOString(),
          url: 'http://minio.local/bucket/disputes/d-1/a.jpg?sig=1',
        },
      ],
    });

    const { findByText, queryByLabelText } = renderScreen();
    fireEvent.press(await findByText('Бронь: Помидоры розовые'));

    expect(await findByText('Доказательства · 1')).toBeTruthy();
    expect(queryByLabelText('Доказательство: yashiki.jpg')).not.toBeNull();
  });

  it('детали кейса: сбой списка доказательств не ломает кейс', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [makeDispute()] });
    mockApi.dispute.mockResolvedValue(makeDisputeDetail());
    mockApi.disputeEvidence.mockRejectedValue(new Error('network'));

    const { findByText } = renderScreen();
    fireEvent.press(await findByText('Бронь: Помидоры розовые'));

    // Кейс открыт, имена файлов показаны (fallback отображения).
    expect(await findByText('Доказательства · 1')).toBeTruthy();
    expect(await findByText('yashiki.jpg')).toBeTruthy();
  });

  it('отмена выбора фото — ничего не отправляется', async () => {
    mockApi.myDisputes.mockResolvedValue({ items: [makeDispute()] });
    mockApi.dispute.mockResolvedValue(makeDisputeDetail());
    mockApi.disputeEvidence.mockResolvedValue({ items: [] });
    mockPick.mockResolvedValue(null);

    const { findByText } = renderScreen();
    fireEvent.press(await findByText('Бронь: Помидоры розовые'));
    const attachButton = await findByText('Приложить фото');
    fireEvent.press(attachButton);

    await waitFor(() => {
      expect(mockPick).toHaveBeenCalledTimes(1);
    });
  });
});
