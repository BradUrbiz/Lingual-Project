import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgMembersTab } from './OrgMembersTab';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

describe('OrgMembersTab', () => {
  it('lists school_admins and teachers + aggregate student count', async () => {
    vi.mocked(api.fetchOrgMembers).mockResolvedValue({
      members: [
        { membershipId: 'm1', uid: 'u1', email: 'a@x.com', name: 'A', roles: ['school_admin'], status: 'active' },
        { membershipId: 'm2', uid: 'u2', email: 'b@x.com', name: 'B', roles: ['teacher'], status: 'active' },
      ],
      studentCount: 42,
    });
    render(<OrgMembersTab orgId="o1" />);
    await waitFor(() => screen.getByText('a@x.com'));
    expect(screen.getByText(/42 students/i)).toBeInTheDocument();
  });

  it('opens RemoveMemberModal and calls removeMember on confirm', async () => {
    vi.mocked(api.fetchOrgMembers).mockResolvedValue({
      members: [
        { membershipId: 'm1', uid: 'u1', email: 'a@x.com', roles: ['school_admin'], status: 'active' },
      ],
      studentCount: 0,
    });
    vi.mocked(api.removeMember).mockResolvedValue();
    render(<OrgMembersTab orgId="o1" />);
    await waitFor(() => screen.getByText('a@x.com'));
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'left school' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() =>
      expect(api.removeMember).toHaveBeenCalledWith('o1', 'm1', { reason: 'left school' }),
    );
  });

  it('disables Confirm when reason is empty', async () => {
    vi.mocked(api.fetchOrgMembers).mockResolvedValue({
      members: [{ membershipId: 'm1', uid: 'u1', email: 'a@x.com', roles: ['teacher'], status: 'active' }],
      studentCount: 0,
    });
    render(<OrgMembersTab orgId="o1" />);
    await waitFor(() => screen.getByText('a@x.com'));
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeDisabled();
  });
});
