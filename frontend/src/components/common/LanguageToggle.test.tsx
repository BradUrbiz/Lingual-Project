import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { LanguageToggle } from './LanguageToggle';

describe('LanguageToggle', () => {
  beforeEach(() => localStorage.clear());

  it('navigates to the /ko path when switching to KO', async () => {
    const assign = vi.fn();
    // jsdom: stub the navigation sink the toggle uses.
    vi.stubGlobal('location', { pathname: '/app/teacher', assign } as unknown as Location);
    render(<LanguageProvider initialLang="en"><LanguageToggle /></LanguageProvider>);
    await act(async () => {
      screen.getByText('KO').click();
    });
    expect(assign).toHaveBeenCalledWith('/ko/app/teacher');
    expect(localStorage.getItem('lingual.uiLanguage')).toBe('ko');
  });

  it('does not navigate when clicking the already-active language', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/app/teacher', assign } as unknown as Location);
    render(<LanguageProvider initialLang="en"><LanguageToggle /></LanguageProvider>);
    await act(async () => {
      screen.getByText('EN').click();
    });
    expect(assign).not.toHaveBeenCalled();
  });
});
