// frontend/src/contexts/LanguageContext.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LanguageProvider, useLanguage } from './LanguageContext';

function Probe() {
  const { lang, setLang } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang('ko')}>ko</button>
    </div>
  );
}

describe('LanguageProvider', () => {
  beforeEach(() => localStorage.clear());

  it('uses initialLang when provided', () => {
    render(<LanguageProvider initialLang="ko"><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('defaults to en with no initialLang', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('en');
  });

  it('persists setLang to localStorage', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    act(() => { screen.getByText('ko').click(); });
    expect(localStorage.getItem('lingual.uiLanguage')).toBe('ko');
  });
});
