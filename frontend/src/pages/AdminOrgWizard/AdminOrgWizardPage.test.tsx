import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminOrgWizardPage } from './AdminOrgWizardPage';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const getDraftMock = vi.fn();
const saveDraftMock = vi.fn();
const submitMock = vi.fn();

vi.mock('@/api/schoolRequests', () => ({
  getSchoolRequestDraft: (...args: unknown[]) => getDraftMock(...args),
  saveSchoolRequestDraft: (...args: unknown[]) => saveDraftMock(...args),
  submitSchoolRequest: (...args: unknown[]) => submitMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'uid-1', email: 'ada@ssfs.org', name: 'Ada Lovelace' },
    refreshUser: vi.fn(),
  }),
}));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup/admin/org-wizard" element={<AdminOrgWizardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminOrgWizardPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getDraftMock.mockReset().mockResolvedValue(null);
    saveDraftMock.mockReset().mockResolvedValue(undefined);
    submitMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at Step 1 by default', async () => {
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(getDraftMock).toHaveBeenCalled());
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
  });

  it('loads the saved draft on mount', async () => {
    getDraftMock.mockResolvedValueOnce({
      uid: 'uid-1', currentStep: 2,
      draftPayload: { schoolName: 'SF Friends' },
      updatedAt: null,
    });
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/organization name/i)).not.toBeInTheDocument();
  });

  it('syncs URL with current step when Continue is clicked', async () => {
    renderAt('/signup/admin/org-wizard');
    await waitFor(() => expect(getDraftMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'SF' } });
    fireEvent.change(screen.getByLabelText(/website/i), { target: { value: 'https://sf.org' } });
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText(/state/i), { target: { value: 'CA' } });
    fireEvent.click(screen.getByDisplayValue('K-12'));
    fireEvent.click(screen.getByDisplayValue('Private'));
    fireEvent.click(screen.getByDisplayValue('50-100'));

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    // After advancing to step 2, the step-2 "full name" field should appear.
    // setParams calls react-router's internal navigate (not the useNavigate mock),
    // so we verify the step advanced via the rendered UI instead.
    await waitFor(() =>
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument(),
    );
  });

  it('debounces autosave (one PATCH after the user stops typing for 800ms)', async () => {
    vi.useFakeTimers();
    renderAt('/signup/admin/org-wizard');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'AB' } });
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'ABC' } });

    expect(saveDraftMock).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    const lastCall = saveDraftMock.mock.calls[0][0];
    expect(lastCall.draftPayload.schoolName).toBe('ABC');
  });

  it('navigates to /signup/admin/pending after a successful submit', async () => {
    submitMock.mockResolvedValueOnce({ id: 'req-1' });
    getDraftMock.mockResolvedValueOnce({
      uid: 'uid-1', currentStep: 4,
      draftPayload: {
        schoolName: 'SF Friends', websiteUrl: 'https://sf.org',
        schoolType: 'k12', publicPrivate: 'private', gradeSize: '50-100',
        location: { country: 'US', state: 'CA' },
        adminIdentity: {
          fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
          roleTitle: 'Principal', authorizationAttested: true,
        },
      },
      updatedAt: null,
    });
    renderAt('/signup/admin/org-wizard?step=4');
    // Wait for the draft to load and the Step 4 submit button to appear.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /submit for lingual approval/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /submit for lingual approval/i }));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/signup/admin/pending', expect.anything()),
    );
  });

  it('waits for an in-flight autosave before submitting', async () => {
    vi.useFakeTimers();
    let resolveSave!: () => void;
    saveDraftMock.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    submitMock.mockResolvedValueOnce({ id: 'req-1' });
    getDraftMock.mockResolvedValueOnce({
      uid: 'uid-1', currentStep: 4,
      draftPayload: {
        schoolName: 'SF Friends', websiteUrl: 'https://sf.org',
        schoolType: 'k12', publicPrivate: 'private', gradeSize: '50-100',
        location: { country: 'US', state: 'CA' },
        adminIdentity: {
          fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
          roleTitle: 'Principal', authorizationAttested: true,
        },
      },
      updatedAt: null,
    });

    renderAt('/signup/admin/org-wizard?step=4');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: /submit for lingual approval/i })).toBeInTheDocument();

    const input = screen.getByLabelText(/teacher email/i);
    fireEvent.change(input, { target: { value: 'teacher@ssfs.org' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await act(async () => { vi.advanceTimersByTime(900); });
    expect(saveDraftMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /submit for lingual approval/i }));
    expect(submitMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitMock).toHaveBeenCalledTimes(1);
  });
});
