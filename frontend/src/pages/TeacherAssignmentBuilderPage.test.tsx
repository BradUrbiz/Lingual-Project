import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeacherAssignmentBuilderPage } from '@/pages/TeacherAssignmentBuilderPage';
import type { CurriculumPackageV1, StudentAssignmentSummary, TeacherClassSummary } from '@/types';
import type { CanvasCourseContentItem } from '@/types/canvas';

const navigateMock = vi.fn();
const getTeacherClassesMock = vi.fn();
const getTeacherCurriculumPackagesMock = vi.fn();
const getSampleCurriculumPackageMock = vi.fn();
const getCurriculumMappingsMock = vi.fn();
const getTeacherAssignmentsMock = vi.fn();
const createCurriculumMappingMock = vi.fn();
const createAssignmentMock = vi.fn();
const getCanvasContentForClassMock = vi.fn();
const linkAssignmentToCanvasMock = vi.fn();
const unlinkAssignmentFromCanvasMock = vi.fn();
const generateCanvasPracticeMock = vi.fn();
const createCanvasPracticeMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ classId: 'class-1' }),
  };
});

vi.mock('@/api/teacher', () => ({
  getTeacherClasses: (...args: unknown[]) => getTeacherClassesMock(...args),
}));

vi.mock('@/api/assignments', () => ({
  getTeacherCurriculumPackages: (...args: unknown[]) => getTeacherCurriculumPackagesMock(...args),
  getCurriculumMappings: (...args: unknown[]) => getCurriculumMappingsMock(...args),
  getTeacherAssignments: (...args: unknown[]) => getTeacherAssignmentsMock(...args),
  createCurriculumMapping: (...args: unknown[]) => createCurriculumMappingMock(...args),
  createAssignment: (...args: unknown[]) => createAssignmentMock(...args),
}));

vi.mock('@/api/canvas', () => ({
  getCanvasContentForClass: (...args: unknown[]) => getCanvasContentForClassMock(...args),
  linkAssignmentToCanvas: (...args: unknown[]) => linkAssignmentToCanvasMock(...args),
  unlinkAssignmentFromCanvas: (...args: unknown[]) => unlinkAssignmentFromCanvasMock(...args),
}));

vi.mock('@/api/canvasPractice', () => ({
  generateCanvasPractice: (...args: unknown[]) => generateCanvasPracticeMock(...args),
  createCanvasPractice: (...args: unknown[]) => createCanvasPracticeMock(...args),
}));

vi.mock('@/api/curriculum', () => ({
  getSampleCurriculumPackage: (...args: unknown[]) => getSampleCurriculumPackageMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

const TEACHER_CLASS: TeacherClassSummary = {
  id: 'class-1',
  orgId: 'org-1',
  name: 'French 2 - Period 3',
  term: 'Spring 2026',
  subject: 'French',
  learningLocale: 'fr-FR',
  status: 'active',
  studentCount: 12,
  assignmentCount: 0,
};

const SAMPLE_CURRICULUM = {
  schemaVersion: 'lingual.curriculum_package.v1',
  curriculum: {
    id: 'sample-ap-french',
    title: { en: 'Sample AP French' },
    learningLocale: 'fr-FR',
    levelBand: 'B1-B2',
    version: '2026.03',
    source: { type: 'native', name: 'Sample AP French' },
    createdAt: '2026-03-01T00:00:00Z',
    license: { owner: 'Lingual', notes: 'Sample' },
  },
  taxonomies: {
    contextTags: ['restaurant', 'ordering'],
    communicativeFunctions: [],
    discourseMoves: [],
    taskModels: [],
    foundationDomains: [],
  },
  rubrics: [],
  units: [
    {
      id: 'U1',
      title: { en: 'Unit 1' },
      ap: { unitNumber: 1, title: 'Unit 1' },
      essentialQuestions: [],
      contextTags: [],
      moduleIds: ['M1'],
      sourceRefs: [],
    },
  ],
  modules: [
    {
      id: 'M1',
      unitId: 'U1',
      title: { en: 'Restaurant roleplay' },
      moduleGoal: { en: 'Order food politely.' },
      capstone: {
        mode: 'interpersonal_speaking',
        taskModel: 'ap.conversation',
        situationId: 'S1',
      },
      situations: {
        interpretive_listening: [],
        interpersonal_speaking: [
          {
            id: 'S1',
            kind: 'interpersonal_speaking',
            seed: {
              setting: 'Restaurant',
              roles: ['learner', 'server'],
              contextTags: ['restaurant', 'ordering'],
              register: 'mixed',
              constraints: { minTurns: 4 },
            },
            objectiveIds: ['OBJ1'],
          },
        ],
        presentational_speaking: [],
      },
      supportTargets: {
        comprehension: [],
        comprehensibility: [],
        vocabulary_usage: [],
        language_control: [],
        communication_strategies: [],
        cultural_awareness: [],
      },
      objectiveIds: ['OBJ1'],
      sourceRefs: [],
    },
  ],
  objectives: [
    {
      id: 'OBJ1',
      unitId: 'U1',
      moduleId: 'M1',
      mode: 'interpersonal_speaking',
      canDo: { en: 'I can order politely in a restaurant.' },
      contextTags: ['restaurant'],
      communicativeFunctions: [],
      discourseMoves: [],
      foundationDomains: [],
      register: 'mixed',
      mastery: { rubricId: 'rub-1', threshold: 2 },
      evidenceModel: { taskModel: 'ap.conversation' },
      templateRefs: ['tpl.restaurant_roleplay.v1'],
      sourceRefs: [],
    },
  ],
  templates: {
    activityTemplateIds: ['tpl.restaurant_roleplay.v1'],
    activityTemplates: [
      {
        id: 'tpl.restaurant_roleplay.v1',
        title: { en: 'Restaurant Service Roleplay' },
        mode: 'interpersonal_speaking',
        assistantRole: 'Act as the server and make the learner drive the ordering process.',
        interactionPattern: {
          openingMoves: ['Open with a greeting and wait for the learner to begin the order.'],
          sustainMoves: ['Answer menu questions briefly, then push the learner to clarify or add detail.'],
          closingMoves: ['Close only after the learner confirms the final order.'],
          completionRule: 'The learner must place an order and ask at least one follow-up question.',
        },
        promptCues: ['Keep the restaurant roleplay natural and concise.'],
      },
    ],
  },
} as unknown as CurriculumPackageV1;

const CANVAS_ITEMS: CanvasCourseContentItem[] = [
  {
    id: 'canvas-content-1',
    connectionId: 'conn-1',
    classId: 'class-1',
    canvasModuleId: 'mod-1',
    canvasModuleName: 'Unit 1: Restaurants',
    canvasModulePosition: 1,
    canvasItemId: 'item-1',
    title: 'Intro: Reading a French menu',
    itemType: 'Page',
    itemPosition: 1,
    dueAt: null,
    pointsPossible: null,
    htmlUrl: null,
    lingualAssignmentId: null,
  },
  {
    id: 'canvas-content-2',
    connectionId: 'conn-1',
    classId: 'class-1',
    canvasModuleId: 'mod-1',
    canvasModuleName: 'Unit 1: Restaurants',
    canvasModulePosition: 1,
    canvasItemId: 'item-2',
    title: 'Ordering dinner: speaking practice',
    itemType: 'Assignment',
    itemPosition: 2,
    dueAt: null,
    pointsPossible: null,
    htmlUrl: null,
    lingualAssignmentId: null,
  },
];

describe('TeacherAssignmentBuilderPage', () => {
  let mappings: Array<{
    id: string;
    orgId: string;
    classId: string;
    packageId: string;
    moduleId: string;
    objectiveIds: string[];
    situationIds: string[];
    targetExpressions: string[];
    focusGrammar: string[];
    allowedContextTags: string[];
    feedbackPolicy: {
      mode: string;
      targetOnlyStrict: boolean;
      recastDefault: boolean;
      elicitationRepeatThreshold: number;
      endReviewEnabled: boolean;
    };
    scaffoldPolicy: {
      silenceToleranceMs: number;
      hintLadder: string[];
      maxModelingSteps: number;
    };
    outputPolicy?: {
      minStudentTurnWords: number;
      followUpPressure: string;
      allowClarificationRequests: boolean;
    };
    modalityPolicy: {
      mode: 'hybrid' | 'voice_only' | 'text_only';
      voiceMinutesCap?: number | null;
      textFallbackEnabled: boolean;
    };
    rubricFocus: string[];
    teacherNotes: string;
    createdByUid: string;
  }> = [];
  let assignments: StudentAssignmentSummary[] = [];

  beforeEach(() => {
    navigateMock.mockReset();
    getTeacherClassesMock.mockReset();
    getTeacherCurriculumPackagesMock.mockReset();
    getSampleCurriculumPackageMock.mockReset();
    getCurriculumMappingsMock.mockReset();
    getTeacherAssignmentsMock.mockReset();
    createCurriculumMappingMock.mockReset();
    createAssignmentMock.mockReset();
    getCanvasContentForClassMock.mockReset();
    linkAssignmentToCanvasMock.mockReset();
    unlinkAssignmentFromCanvasMock.mockReset();
    generateCanvasPracticeMock.mockReset();
    createCanvasPracticeMock.mockReset();

    mappings = [];
    assignments = [];

    getTeacherClassesMock.mockResolvedValue([TEACHER_CLASS]);
    getTeacherCurriculumPackagesMock.mockResolvedValue({
      packages: [
        {
          id: 'sample-ap-french',
          title: { en: 'Sample AP French' },
          learningLocale: 'fr-FR',
          levelBand: 'B1-B2',
          version: '2026.03',
          sourceType: 'native',
          status: 'active',
          ownerScope: 'global',
        },
      ],
      limitations: [],
    });
    getSampleCurriculumPackageMock.mockResolvedValue(SAMPLE_CURRICULUM);
    getCurriculumMappingsMock.mockImplementation(async () => mappings);
    getTeacherAssignmentsMock.mockImplementation(async () => assignments);
    getCanvasContentForClassMock.mockResolvedValue([]);

    createCurriculumMappingMock.mockImplementation(async (_classId: string, payload: Record<string, unknown>) => {
      const created = {
        id: 'mapping-1',
        orgId: 'org-1',
        classId: 'class-1',
        packageId: payload.packageId as string,
        moduleId: payload.moduleId as string,
        objectiveIds: payload.objectiveIds as string[],
        situationIds: payload.situationIds as string[],
        targetExpressions: payload.targetExpressions as string[],
        focusGrammar: payload.focusGrammar as string[],
        allowedContextTags: payload.allowedContextTags as string[],
        feedbackPolicy: {
          mode: 'balanced',
          targetOnlyStrict: false,
          recastDefault: true,
          elicitationRepeatThreshold: 3,
          endReviewEnabled: true,
        },
        scaffoldPolicy: {
          silenceToleranceMs: 3000,
          hintLadder: ['wait', 'context_hint', 'choice_prompt', 'model_and_retry'],
          maxModelingSteps: 1,
        },
        outputPolicy: {
          minStudentTurnWords: (payload.outputPolicy as { minStudentTurnWords: number } | undefined)?.minStudentTurnWords ?? 8,
          followUpPressure: (payload.outputPolicy as { followUpPressure: string } | undefined)?.followUpPressure ?? 'balanced',
          allowClarificationRequests:
            (payload.outputPolicy as { allowClarificationRequests: boolean } | undefined)?.allowClarificationRequests ?? true,
        },
        modalityPolicy: {
          mode: 'hybrid' as const,
          voiceMinutesCap: null,
          textFallbackEnabled: true,
        },
        rubricFocus: payload.rubricFocus as string[],
        teacherNotes: payload.teacherNotes as string,
        createdByUid: 'teacher-1',
      };
      mappings = [created];
      return created;
    });

    createAssignmentMock.mockImplementation(async (_classId: string, payload: Record<string, unknown>) => {
      const created: StudentAssignmentSummary = {
        id: 'assignment-1',
        orgId: 'org-1',
        classId: 'class-1',
        mappingId: payload.mappingId as string,
        title: payload.title as string,
        description: payload.description as string,
        status: payload.status as 'draft' | 'published' | 'archived',
        taskType: payload.taskType as 'information_gap' | 'opinion_gap' | 'decision_making',
        successCriteria: payload.successCriteria as string[],
        modalityOverride: {
          mode: 'hybrid',
          voiceMinutesCap: null,
          textFallbackEnabled: true,
        },
        createdByUid: 'teacher-1',
        className: 'French 2 - Period 3',
      };
      assignments = [created];
      return created;
    });
  });

  it('creates a mapping and then creates an assignment from it (advanced mode)', async () => {
    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    // Switch to advanced mode (Quick Assignment is the default)
    fireEvent.click(screen.getByText('Advanced'));

    await screen.findByText('Interaction contract preview');
    await screen.findByText('Act as the server and make the learner drive the ordering process.');
    await screen.findByText('Opening moves');

    fireEvent.change(screen.getByLabelText('Target expressions'), {
      target: { value: 'Could I have\nI would like' },
    });
    fireEvent.change(screen.getByLabelText('Minimum student turn words'), {
      target: { value: '11' },
    });
    fireEvent.change(screen.getByLabelText('Follow-up pressure'), {
      target: { value: 'high' },
    });
    fireEvent.click(screen.getByLabelText('Allow clarification requests'));
    fireEvent.change(screen.getByLabelText('Teacher notes'), {
      target: { value: 'Keep the learner in the restaurant lane.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save curriculum mapping' }));

    await waitFor(() => {
      expect(createCurriculumMappingMock).toHaveBeenCalledWith(
        'class-1',
        expect.objectContaining({
          packageId: 'sample-ap-french',
          moduleId: 'M1',
          situationIds: ['S1'],
          objectiveIds: ['OBJ1'],
          targetExpressions: ['Could I have', 'I would like'],
          outputPolicy: {
            minStudentTurnWords: 11,
            followUpPressure: 'high',
            allowClarificationRequests: false,
          },
          teacherNotes: 'Keep the learner in the restaurant lane.',
        })
      );
    });

    fireEvent.change(screen.getByLabelText('Assignment title'), {
      target: { value: 'Restaurant mission' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Order dinner and ask a follow-up question.' },
    });
    fireEvent.change(screen.getByLabelText('Success criteria'), {
      target: { value: 'Use one polite request\nAsk one follow-up question' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'published' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create assignment' }));

    await waitFor(() => {
      expect(createAssignmentMock).toHaveBeenCalledWith(
        'class-1',
        expect.objectContaining({
          mappingId: 'mapping-1',
          title: 'Restaurant mission',
          description: 'Order dinner and ask a follow-up question.',
          status: 'published',
          successCriteria: ['Use one polite request', 'Ask one follow-up question'],
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Restaurant mission')).toBeInTheDocument();
    });

    expect(screen.getByText(/Output pressure: 11\+ words per turn/i)).toBeInTheDocument();
    expect(screen.getByText(/Interaction contract: Restaurant Service Roleplay/i)).toBeInTheDocument();
  });

  it('Quick Assign shows an empty state when no Canvas course is connected', async () => {
    getCanvasContentForClassMock.mockResolvedValue([]);

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    // Quick Assign is the default mode; empty-state messaging appears.
    expect(screen.getByText('Connect a Canvas course first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Canvas' })).toBeInTheDocument();
  });

  it('Quick Assign: generates from Canvas, edits, and publishes', async () => {
    getCanvasContentForClassMock.mockResolvedValue(CANVAS_ITEMS);
    generateCanvasPracticeMock.mockResolvedValue({
      success: true,
      canvasItem: {
        id: 'canvas-content-2',
        title: 'Ordering dinner: speaking practice',
        type: 'Assignment',
        moduleName: 'Unit 1: Restaurants',
        canvasItemId: 'item-2',
      },
      suggestions: {
        scenario: 'You are at a Parisian bistro ordering dinner with a friend.',
        targetExpressions: ["Je voudrais…", "L'addition, s'il vous plaît"],
        focusGrammar: ['conditional polite requests'],
        successCriteria: ['Order at least two items', 'Ask one follow-up question'],
        taskType: 'decision_making',
        suggestedTitle: 'Dinner at the bistro',
        suggestedDescription: 'Order a two-course dinner and negotiate with the server.',
        teacherNotes: 'Keep learners in the restaurant register.',
      },
    });
    createCanvasPracticeMock.mockResolvedValue({
      success: true,
      assignmentId: 'assignment-1',
      status: 'published',
    });

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    // Canvas picker should be visible in Quick Assign.
    const picker = await screen.findByLabelText('Canvas item');
    fireEvent.change(picker, { target: { value: 'canvas-content-2' } });

    // Generate
    fireEvent.click(screen.getByRole('button', { name: /Generate practice from this item/i }));

    await waitFor(() => {
      expect(generateCanvasPracticeMock).toHaveBeenCalledWith('class-1', 'canvas-content-2');
    });

    // Review form renders with the suggested title pre-filled.
    const titleInput = await screen.findByDisplayValue('Dinner at the bistro');
    fireEvent.change(titleInput, { target: { value: 'Dinner at the bistro (edited)' } });

    // Status defaults to Draft. Explicitly flip to Published before publishing.
    fireEvent.click(screen.getByRole('radio', { name: 'Published' }));

    // Publish.
    fireEvent.click(screen.getByRole('button', { name: /Publish assignment/i }));

    await waitFor(() => {
      expect(createCanvasPracticeMock).toHaveBeenCalledTimes(1);
    });

    expect(createCanvasPracticeMock).toHaveBeenCalledWith(
      'class-1',
      expect.objectContaining({
        canvasContentId: 'canvas-content-2',
        canvasModuleItemId: 'item-2',
        title: 'Dinner at the bistro (edited)',
        description: 'Order a two-course dinner and negotiate with the server.',
        scenario: 'You are at a Parisian bistro ordering dinner with a friend.',
        targetExpressions: ["Je voudrais…", "L'addition, s'il vous plaît"],
        focusGrammar: ['conditional polite requests'],
        successCriteria: ['Order at least two items', 'Ask one follow-up question'],
        taskType: 'decision_making',
        status: 'published',
      })
    );

    // After publish the Your assignments card should refresh and include the new assignment.
    assignments = [
      {
        id: 'assignment-1',
        orgId: 'org-1',
        classId: 'class-1',
        mappingId: 'mapping-1',
        title: 'Dinner at the bistro (edited)',
        description: 'Order a two-course dinner and negotiate with the server.',
        status: 'published',
        taskType: 'decision_making',
        successCriteria: ['Order at least two items'],
        modalityOverride: { mode: 'hybrid', voiceMinutesCap: null, textFallbackEnabled: true },
        createdByUid: 'teacher-1',
        className: 'French 2 - Period 3',
      },
    ];

    // The success banner should render.
    await waitFor(() => {
      const banner = screen.getByText(/has been published/i);
      expect(banner).toBeInTheDocument();
      expect(within(banner).queryByText(/Dinner at the bistro \(edited\)/)).not.toBeNull();
    });
  });
});
