import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgClassesTab } from './OrgClassesTab';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');
beforeEach(() => vi.resetAllMocks());

describe('OrgClassesTab', () => {
  it('renders class rows', async () => {
    vi.mocked(api.fetchOrgClasses).mockResolvedValue({
      items: [
        { id: 'c1', name: 'Spanish I', term: 'F26', subject: 'spanish', teacherMembershipIds: ['m1'] },
        { id: 'c2', name: 'French II', term: 'S26', subject: 'french', teacherMembershipIds: ['m2', 'm3'] },
      ],
    });
    render(<OrgClassesTab orgId="o1" />);
    await waitFor(() => screen.getByText('Spanish I'));
    expect(screen.getByText('French II')).toBeInTheDocument();
  });

  it('does not render links into classes (no browsable internals)', async () => {
    vi.mocked(api.fetchOrgClasses).mockResolvedValue({
      items: [{ id: 'c1', name: 'Spanish I', teacherMembershipIds: [] }],
    });
    render(<OrgClassesTab orgId="o1" />);
    await waitFor(() => screen.getByText('Spanish I'));
    expect(screen.queryByRole('link', { name: /spanish i/i })).not.toBeInTheDocument();
  });

  it('shows empty state', async () => {
    vi.mocked(api.fetchOrgClasses).mockResolvedValue({ items: [] });
    render(<OrgClassesTab orgId="o1" />);
    await waitFor(() => screen.getByText(/no classes/i));
  });
});
