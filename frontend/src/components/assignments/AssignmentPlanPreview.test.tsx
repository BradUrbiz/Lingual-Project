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

describe('AssignmentPlanPreview realized', () => {
  beforeEach(() => getAssignmentPlanPreviewMock.mockReset());

  it('renders realized hits and the never-elicited callout', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: true, rawTutorMode: false, taskType: 'opinion_gap',
      targets: [
        { surface: 'hola', kind: 'expression', feedbackRoute: 'recast_first' },
        { surface: 'subj', kind: 'grammar_rule', feedbackRoute: 'prompt_first' },
      ],
      realized: {
        studentCount: 3, sessionCount: 4,
        perTarget: [
          { surface: 'hola', kind: 'expression', measurable: true, hits: 5, tier: 'solid', studentsElicited: 3 },
          { surface: 'subj', kind: 'grammar_rule', measurable: false, hits: null, tier: null, studentsElicited: null },
        ],
        neverElicited: ['adios'],
        alignmentRate: { measurableTargetCount: 1, elicitedCount: 1, solidCount: 1 },
      },
    });
    render(<AssignmentPlanPreview assignmentId="a1" withRealized />);
    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(screen.getByText(/5 · solid · 3\/3/)).toBeInTheDocument();  // realized cell (one node)
    expect(screen.getByText('adios')).toBeInTheDocument();        // never-elicited surface
    expect(screen.getByTestId('align-never-elicited')).toBeInTheDocument();
  });
});
