import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CanvasConnectPage } from '@/pages/CanvasConnectPage';

const navigateMock = vi.fn();
const validateMock = vi.fn();
const connectMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ classId: 'class-1' }),
    useSearchParams: () => [new URLSearchParams()],
  };
});

vi.mock('@/api/canvas', () => ({
  validateCanvasConnection: (...args: unknown[]) => validateMock(...args),
  connectCanvas: (...args: unknown[]) => connectMock(...args),
}));

vi.mock('@/api/lti', () => ({
  getLtiPlatform: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

describe('CanvasConnectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders credential form initially', () => {
    render(<CanvasConnectPage />);
    expect(screen.getByLabelText('integrations.canvas.instanceUrlLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('integrations.canvas.patLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'integrations.canvas.validateBtn' })).toBeInTheDocument();
  });

  it('calls validate and shows course selection', async () => {
    validateMock.mockResolvedValue({
      success: true,
      teacher: { id: 1, name: 'Teacher' },
      courses: [
        { id: 100, name: 'Korean 101', courseCode: 'KOR101' },
        { id: 200, name: 'Korean 201', courseCode: 'KOR201' },
      ],
    });

    render(<CanvasConnectPage />);

    fireEvent.change(screen.getByLabelText('integrations.canvas.instanceUrlLabel'), {
      target: { value: 'https://school.instructure.com' },
    });
    fireEvent.change(screen.getByLabelText('integrations.canvas.patLabel'), {
      target: { value: 'test-pat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.canvas.validateBtn' }));

    await waitFor(() => {
      expect(screen.getByText('Korean 101')).toBeInTheDocument();
      expect(screen.getByText('Korean 201')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'integrations.canvas.connectCourseBtn' })).toBeInTheDocument();
  });

  it('connects and navigates to class analytics', async () => {
    validateMock.mockResolvedValue({
      success: true,
      teacher: { id: 1, name: 'Teacher' },
      courses: [{ id: 100, name: 'Korean 101', courseCode: 'KOR101' }],
    });
    connectMock.mockResolvedValue({
      success: true,
      connectionId: 'conn-1',
      classId: 'class-1',
      roster: null,
      contentCount: 0,
    });

    render(<CanvasConnectPage />);

    fireEvent.change(screen.getByLabelText('integrations.canvas.instanceUrlLabel'), {
      target: { value: 'https://school.instructure.com' },
    });
    fireEvent.change(screen.getByLabelText('integrations.canvas.patLabel'), {
      target: { value: 'test-pat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.canvas.validateBtn' }));

    await waitFor(() => expect(screen.getByText('Korean 101')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'integrations.canvas.connectCourseBtn' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app/teacher/classes/class-1/analytics');
    });
  });

  it('displays error on validate failure', async () => {
    validateMock.mockResolvedValue({
      success: false,
      error: 'Invalid PAT or unauthorized',
    });

    render(<CanvasConnectPage />);

    fireEvent.change(screen.getByLabelText('integrations.canvas.instanceUrlLabel'), {
      target: { value: 'https://school.instructure.com' },
    });
    fireEvent.change(screen.getByLabelText('integrations.canvas.patLabel'), {
      target: { value: 'bad-pat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.canvas.validateBtn' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid PAT or unauthorized');
    });
  });
});
