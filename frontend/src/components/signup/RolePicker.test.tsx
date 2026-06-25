import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RolePicker } from './RolePicker';
import en from '@/i18n/en.json';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    setLang: vi.fn(),
    t: (key: string) => (en as Record<string, string>)[key] ?? key,
  }),
}));

describe('RolePicker', () => {
  it('renders all three role cards', () => {
    render(<RolePicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /teacher/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /school administrator/i })).toBeInTheDocument();
  });

  it('marks the selected role as checked', () => {
    render(<RolePicker value="teacher" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /teacher/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /student/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /school administrator/i })).not.toBeChecked();
  });

  it('calls onChange with the picked role', () => {
    const onChange = vi.fn();
    render(<RolePicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /school administrator/i }));
    expect(onChange).toHaveBeenCalledWith('admin');
  });

  it('disables interaction when disabled prop is true', () => {
    const onChange = vi.fn();
    render(<RolePicker value="student" onChange={onChange} disabled />);
    const teacher = screen.getByRole('radio', { name: /teacher/i });
    expect(teacher).toBeDisabled();
    fireEvent.click(teacher);
    expect(onChange).not.toHaveBeenCalled();
  });
});
