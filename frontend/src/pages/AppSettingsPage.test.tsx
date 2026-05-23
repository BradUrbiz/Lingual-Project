import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppSettingsPage } from '@/pages/AppSettingsPage';

const navigateMock = vi.fn();
const changePasswordMock = vi.fn();
const sendPasswordResetMock = vi.fn();
const getUserProfileMock = vi.fn();
const updateProfileMock = vi.fn();
const getStudentComplianceMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'student@example.com', name: 'Student User' },
    changePassword: (...args: unknown[]) => changePasswordMock(...args),
    sendPasswordReset: (...args: unknown[]) => sendPasswordResetMock(...args),
  }),
}));

vi.mock('@/api/user', () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
  updateProfile: (...args: unknown[]) => updateProfileMock(...args),
}));

vi.mock('@/api/voiceConsent', () => ({
  getStudentCompliance: (...args: unknown[]) => getStudentComplianceMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => {
      const values: Record<string, string> = {
        'nav.settings': 'Settings',
        'app.settings.title': 'Settings',
        'app.settings.tabs.account': 'Account',
        'app.settings.tabs.password': 'Password & Security',
        'app.settings.tabs.notifications': 'Notifications',
        'app.settings.tabs.privacy': 'Privacy & Data',
        'app.settings.tabs.devices': 'Devices',
        'app.settings.password.title': 'Password & Security',
        'app.settings.password.subtitle': 'Update your password or send yourself a reset link.',
        'app.settings.password.current': 'Current Password',
        'app.settings.password.new': 'New Password',
        'app.settings.password.confirm': 'Confirm New Password',
        'app.settings.password.change': 'Change Password',
        'app.settings.password.reset': 'Email me a reset link',
        'app.settings.password.toast.changed': 'Password changed.',
        'app.settings.password.toast.resetSent': 'Password reset link sent.',
        'app.settings.account.subtitle': 'Update your personal details here.',
      };
      return values[key] ?? key;
    },
  }),
}));

vi.mock('@/contexts/LearningLocaleContext', () => ({
  useLearningLocale: () => ({
    learningLocale: 'es-ES',
    setLearningLocale: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const openPasswordTab = () => {
  const passwordTab = screen.getByRole('tab', { name: 'Password & Security' });
  fireEvent.mouseDown(passwordTab, { button: 0, ctrlKey: false });
  fireEvent.click(passwordTab);
};

describe('AppSettingsPage password security', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    changePasswordMock.mockReset();
    sendPasswordResetMock.mockReset();
    updateProfileMock.mockReset();
    getUserProfileMock.mockResolvedValue({
      displayName: 'Student User',
      learningLocale: 'es-ES',
      age: 16,
      gender: null,
      rigor: null,
      frequency: 3,
      frequencyUnit: 'week',
      levelObjective: '',
    });
    getStudentComplianceMock.mockRejectedValue(new Error('not in school context'));
  });

  it('changes password from the security tab', async () => {
    changePasswordMock.mockResolvedValue(undefined);

    render(<AppSettingsPage />);

    openPasswordTab();
    fireEvent.change(await screen.findByLabelText('Current Password'), {
      target: { value: 'old-password' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'new-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'new-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith('old-password', 'new-password');
    });
  });

  it('sends a reset link to the signed-in email from the security tab', async () => {
    sendPasswordResetMock.mockResolvedValue(undefined);

    render(<AppSettingsPage />);

    openPasswordTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a reset link' }));

    await waitFor(() => {
      expect(sendPasswordResetMock).toHaveBeenCalledWith('student@example.com');
    });
  });
});
