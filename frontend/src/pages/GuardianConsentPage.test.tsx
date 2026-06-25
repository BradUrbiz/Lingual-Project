import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GuardianConsentPage } from '@/pages/GuardianConsentPage';
import type { GuardianConsentDecisionResult, GuardianConsentPublicView } from '@/types';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const getGuardianConsentPacketMock = vi.fn();
const submitGuardianConsentDecisionMock = vi.fn();

vi.mock('@/api/guardian', () => ({
  getGuardianConsentPacket: (...args: unknown[]) => getGuardianConsentPacketMock(...args),
  submitGuardianConsentDecision: (...args: unknown[]) => submitGuardianConsentDecisionMock(...args),
}));

const GUARDIAN_NOTICE: GuardianConsentPublicView = {
  packet: {
    id: 'packet-1',
    orgId: 'org-1',
    classId: 'class-1',
    studentUid: 'student-1',
    noticeVersion: 'guardian_beta_v1',
    consentScope: 'voice_school_beta',
    contactChannel: 'email',
    contactDestinationHint: 'parent@example.org',
    deliveryMethod: 'secure_link',
    status: 'viewed',
    tokenLastFour: '1abc',
    reminderCount: 0,
    expiresAt: '2026-03-23T12:00:00Z',
    issuedAt: '2026-03-09T12:00:00Z',
    lastSentAt: '2026-03-09T12:00:00Z',
    actedAt: null,
    createdByUid: 'teacher-1',
    createdAt: '2026-03-09T12:00:00Z',
    updatedAt: '2026-03-09T12:00:00Z',
    canResend: true,
    canCancel: true,
    isTerminal: false,
  },
  notice: {
    version: 'guardian_beta_v1',
    title: 'Guardian consent for Lingual school voice practice',
    summary: 'Please review this school voice-practice notice.',
    bullets: [
      'Voice sessions may process spoken responses.',
      'Text practice remains available when voice consent is not granted.',
    ],
  },
  student: {
    displayName: 'Student One',
  },
  class: {
    name: 'French 2 - Period 3',
    subject: 'French',
  },
};

const DECISION_RESULT: GuardianConsentDecisionResult = {
  guardianConsent: {
    ...GUARDIAN_NOTICE,
    packet: {
      ...GUARDIAN_NOTICE.packet,
      status: 'granted',
      actedAt: '2026-03-10T09:30:00Z',
      canResend: false,
      canCancel: false,
      isTerminal: true,
    },
  },
  guardianPacket: {
    ...GUARDIAN_NOTICE.packet,
    status: 'granted',
    actedAt: '2026-03-10T09:30:00Z',
    canResend: false,
    canCancel: false,
    isTerminal: true,
  },
  compliance: {
    id: 'org-1_student-1',
    orgId: 'org-1',
    studentUid: 'student-1',
    isMinor: true,
    guardianConsentStatus: 'granted',
    voiceConsentStatus: 'unknown',
    textAllowed: true,
    voiceAllowed: false,
    retentionPolicyId: 'standard_school',
    retentionPolicy: {
      id: 'standard_school',
      label: 'Standard school retention',
      rawAudioStorageAllowed: true,
      rawAudioRetentionDays: 30,
      transcriptRetentionDays: 365,
      analyticsRetentionDays: 730,
    },
    lastVerifiedAt: '2026-03-10T09:30:00Z',
  },
};

describe('GuardianConsentPage', () => {
  beforeEach(() => {
    getGuardianConsentPacketMock.mockReset();
    submitGuardianConsentDecisionMock.mockReset();
    getGuardianConsentPacketMock.mockResolvedValue(GUARDIAN_NOTICE);
    submitGuardianConsentDecisionMock.mockResolvedValue(DECISION_RESULT);
  });

  it('loads a secure-link notice and records a guardian decision', async () => {
    render(
      <MemoryRouter initialEntries={['/guardian/consent/token-abc']}>
        <Routes>
          <Route path="/guardian/consent/:token" element={<GuardianConsentPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Guardian consent for Lingual school voice practice')).toBeInTheDocument();
    expect(screen.getByText('guardian.consent.notice.appliesTo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'guardian.consent.action.grant' }));

    await waitFor(() => {
      expect(submitGuardianConsentDecisionMock).toHaveBeenCalledWith('token-abc', {
        decision: 'granted',
        acknowledged: true,
      });
    });

    expect(await screen.findByText('guardian.consent.decisionRecorded.title')).toBeInTheDocument();
    expect(screen.getByText('guardian.consent.decisionRecorded.desc')).toBeInTheDocument();
  });
});
