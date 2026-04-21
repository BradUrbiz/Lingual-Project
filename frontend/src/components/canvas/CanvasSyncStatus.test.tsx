import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CanvasSyncStatus } from './CanvasSyncStatus';

const navigateMock = vi.fn();
const getCanvasStatusMock = vi.fn();
const syncCanvasMock = vi.fn();
const disconnectCanvasMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/api/canvas', () => ({
  getCanvasStatus: (...args: unknown[]) => getCanvasStatusMock(...args),
  syncCanvas: (...args: unknown[]) => syncCanvasMock(...args),
  disconnectCanvas: (...args: unknown[]) => disconnectCanvasMock(...args),
}));

describe('CanvasSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows connect button when not connected', async () => {
    getCanvasStatusMock.mockResolvedValue({ connected: false });
    render(<CanvasSyncStatus classId="class-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Connect Canvas/i })).toBeInTheDocument();
    });
  });

  it('shows sync status when connected', async () => {
    getCanvasStatusMock.mockResolvedValue({
      connected: true,
      canvasCourseName: 'Korean 101',
      syncStatus: 'completed',
    });
    render(<CanvasSyncStatus classId="class-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Korean 101/)).toBeInTheDocument();
      expect(screen.getByText('Synced')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh Canvas roster/i })).toBeInTheDocument();
    });
  });

  it('shows error sync status', async () => {
    getCanvasStatusMock.mockResolvedValue({
      connected: true,
      canvasCourseName: 'Korean 101',
      syncStatus: 'error',
    });
    render(<CanvasSyncStatus classId="class-1" />);
    await waitFor(() => {
      expect(screen.getByText('Sync error')).toBeInTheDocument();
    });
  });

  it('triggers sync and renders roster result copy', async () => {
    getCanvasStatusMock.mockResolvedValue({
      connected: true,
      canvasCourseName: 'Korean 101',
      syncStatus: 'completed',
    });
    syncCanvasMock.mockResolvedValue({
      success: true,
      roster: { entries_upserted: 12, entries_removed: 2, total_canvas_students: 12 },
      contentCount: 5,
    });

    render(<CanvasSyncStatus classId="class-1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Refresh Canvas roster/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh Canvas roster/i }));

    await waitFor(() => {
      expect(syncCanvasMock).toHaveBeenCalledWith('class-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('canvas-roster-result')).toHaveTextContent(
        '12 Canvas students captured, 2 dropped from roster.',
      );
    });
    expect(
      screen.getByText(/share your class code to enroll students/i),
    ).toBeInTheDocument();
  });

  it('navigates to connect page when Connect Canvas clicked', async () => {
    getCanvasStatusMock.mockResolvedValue({ connected: false });
    render(<CanvasSyncStatus classId="class-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Connect Canvas/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Connect Canvas/i }));
    expect(navigateMock).toHaveBeenCalledWith('/app/teacher/classes/class-1/canvas/connect');
  });
});
