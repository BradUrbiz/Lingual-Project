import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssignmentPlanPreview } from './AssignmentPlanPreview';

const getAssignmentPlanPreviewMock = vi.fn();
vi.mock('@/api/teacher', () => ({
  getAssignmentPlanPreview: (...a: unknown[]) => getAssignmentPlanPreviewMock(...a),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en', t: (key: string) => key }),
}));

describe('AssignmentPlanPreview', () => {
  beforeEach(() => getAssignmentPlanPreviewMock.mockReset());

  it('renders the engine preview (task type + a target route)', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: true, rawTutorMode: false, taskType: 'information_gap',
      correctionPosture: { mode: 'balanced', recastDefault: true, elicitationRepeatThreshold: 2 },
      targets: [{ surface: 'la cuenta', kind: 'expression', feedbackRoute: 'recast' }],
    });
    render(<AssignmentPlanPreview assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/la cuenta/)).toBeInTheDocument());
    expect(screen.getByText(/information_gap/)).toBeInTheDocument();
  });

  it('renders the raw-mode notice with disabled guarantees', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: false, rawTutorMode: true,
      guaranteesDisabled: ['target elicitation', 'feedback routing'],
    });
    render(<AssignmentPlanPreview assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/engine is off|raw/i)).toBeInTheDocument());
    expect(screen.getByText(/target elicitation/)).toBeInTheDocument();
  });

  it('renders nothing when the preview is null (flag off / unavailable)', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue(null);
    const { container } = render(<AssignmentPlanPreview assignmentId="a1" />);
    await waitFor(() => expect(getAssignmentPlanPreviewMock).toHaveBeenCalled());
    expect(container.textContent ?? '').not.toMatch(/information_gap|engine is off/i);
  });
});
