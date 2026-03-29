import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudentJoinClassPage } from '@/pages/StudentJoinClassPage';

const navigateMock = vi.fn();
const joinClassByCodeMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/api/schools', () => ({
  joinClassByCode: (...args: unknown[]) => joinClassByCodeMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

describe('StudentJoinClassPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    joinClassByCodeMock.mockReset();
  });

  it('renders the join code input', () => {
    render(<StudentJoinClassPage />);

    expect(screen.getByPlaceholderText('ABC123')).toBeInTheDocument();
    expect(screen.getByText('Join a Class')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join Class/i })).toBeInTheDocument();
  });

  it('joins a class successfully and shows confirmation', async () => {
    joinClassByCodeMock.mockResolvedValue({
      alreadyEnrolled: false,
      class: {
        id: 'class-1',
        name: 'French 2 - Period 3',
        subject: 'French',
      },
    });

    render(<StudentJoinClassPage />);

    const input = screen.getByPlaceholderText('ABC123');
    fireEvent.change(input, { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Class/i }));

    await waitFor(() => {
      expect(joinClassByCodeMock).toHaveBeenCalledWith('ABC123');
    });

    expect(await screen.findByText('Successfully Joined!')).toBeInTheDocument();
    expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    expect(screen.getByText('French')).toBeInTheDocument();
  });

  it('shows error message when join code is invalid', async () => {
    joinClassByCodeMock.mockRejectedValue(new Error('Class not found'));

    render(<StudentJoinClassPage />);

    const input = screen.getByPlaceholderText('ABC123');
    fireEvent.change(input, { target: { value: 'BAD404' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Class/i }));

    await waitFor(() => {
      expect(joinClassByCodeMock).toHaveBeenCalledWith('BAD404');
    });

    expect(await screen.findByText('Class not found')).toBeInTheDocument();
  });

  it('auto-uppercases input and limits to 6 characters', () => {
    render(<StudentJoinClassPage />);

    const input = screen.getByPlaceholderText('ABC123') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc1234567' } });

    expect(input.value).toBe('ABC123');
  });

  it('disables submit button when code is less than 6 characters', () => {
    render(<StudentJoinClassPage />);

    const input = screen.getByPlaceholderText('ABC123');
    fireEvent.change(input, { target: { value: 'AB1' } });

    const button = screen.getByRole('button', { name: /Join Class/i });
    expect(button).toBeDisabled();
  });
});
