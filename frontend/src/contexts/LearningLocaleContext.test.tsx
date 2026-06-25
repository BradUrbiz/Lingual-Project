import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningLocaleProvider, useLearningLocale } from './LearningLocaleContext';

const getUserProfileMock = vi.fn();

vi.mock('@/api/user', () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      email: 'student@example.com',
      name: 'Student',
    },
  }),
}));

vi.mock('./LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en', setLang: vi.fn(), t: (k: string) => k }),
}));

function LocaleProbe() {
  const { learningLocale } = useLearningLocale();
  return <div>Locale: {learningLocale}</div>;
}

describe('LearningLocaleProvider', () => {
  beforeEach(() => {
    getUserProfileMock.mockReset();
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', 'en');
  });

  it('does not leak Hebrew RTL direction onto public document chrome', async () => {
    getUserProfileMock.mockResolvedValue({ learningLocale: 'he-IL' });

    render(
      <LearningLocaleProvider>
        <LocaleProbe />
      </LearningLocaleProvider>,
    );

    await waitFor(() => expect(getUserProfileMock).toHaveBeenCalled());
    await screen.findByText('Locale: he-IL');
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('ltr'));
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });
});
